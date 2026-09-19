import { StateStore } from "../storage/state.js";
import type { MacusConfig } from "../types.js";
import { buildReview } from "../review.js";
import { PiAgentKernel } from "../agent/kernel.js";
import { DurableContinuity } from "../runtime/durable-continuity.js";
import { RuntimeLockCoordinator } from "../runtime/lock-coordinator.js";
import { SessionCoordinator } from "../runtime/session-coordinator.js";
import { currentTranscriptRef } from "../storage/transcript.js";
import { listCheckpoints } from "../storage/checkpoint.js";
import { ManifestStore } from "../context/manifest-store.js";
import { featureEnabled } from "../capabilities.js";
import { gitState, gitDiff, repositoryIdentity } from "../repository.js";
import { captureTrustedCommandSnapshot, diffTrustedCommandSnapshots, trustedSnapshotDigest } from "../testing/discovery.js";
import { redactConfig } from "../config.js";
import { assessVerification } from "../verification/assessment.js";
import { CliCommandRegistry } from "./registry.js";
import { registerDefaultCommands } from "./commands.js";

export interface PromptResult {
  ok: boolean;
  result: string;
  runId?: string;
  error?: unknown;
}

export interface CommandIO {
  print(value: unknown): void;
  printJson(value: unknown): void;
  printText(value: string): void;
  confirm(question: string): Promise<boolean>;
}

/** Owns one CLI session's lifecycle and exposes user actions instead of raw state holders. */
export class CliApplication {
  private kernel?: PiAgentKernel;
  private kernelSessionId?: string;
  private pendingTranscriptRef?: string;
  private readonly authorized = new Set<"edits" | "shell">();
  private modelAlias: string;
  private readonly registry = new CliCommandRegistry();
  private onAssistantText?: (text: string) => void;

  private constructor(
    readonly root: string,
    readonly repoId: string,
    readonly config: MacusConfig,
    readonly store: StateStore,
    readonly sessions: SessionCoordinator,
    readonly locks: RuntimeLockCoordinator,
  ) {
    this.modelAlias = config.models.default;
    registerDefaultCommands(this.registry, this);
  }

  static async open(root: string, config: MacusConfig): Promise<CliApplication> {
    const store = await StateStore.open(root);
    const repoId = await repositoryIdentity(root);
    const sessions = new SessionCoordinator(root, repoId, store);
    const locks = new RuntimeLockCoordinator(root);
    return new CliApplication(root, repoId, config, store, sessions, locks);
  }

  get helpText(): string { return this.registry.help(); }
  get activeModelAlias(): string { return this.modelAlias; }
  get modelAliases(): string[] { return Object.keys(this.config.models.aliases); }

  async initialize(resumeId?: string, authorize?: string): Promise<void> {
    if (resumeId) await this.resumeSession(resumeId);
    if (!authorize) return;
    if (!["edits", "shell", "all"].includes(authorize)) throw new Error("--authorize requires edits|shell|all");
    if (authorize === "all" || authorize === "edits") this.authorized.add("edits");
    if (authorize === "all" || authorize === "shell") this.authorized.add("shell");
  }

  recordStartupMetric(startedAt: number): void {
    this.store.recordMetric({ sessionId: this.sessions.sessionId, name: "cli.startup_ms", value: performance.now() - startedAt });
  }

  async runPrompt(text: string, onText?: (text: string) => void): Promise<PromptResult> {
    this.lastAssistantText = "";
    this.onAssistantText = onText;
    const kernel = await this.ensureKernel();
    if (this.authorized.has("edits")) kernel.authorize("edits");
    if (this.authorized.has("shell")) kernel.authorize("shell");
    try {
      const run = await kernel.prompt(text);
      await kernel.current.waitForIdle();
      return { ok: true, result: this.lastAssistantText, runId: run.runId };
    } catch (error) {
      return { ok: false, result: this.lastAssistantText, error, runId: this.sessions.sessionId ? this.store.latestRunId(this.sessions.sessionId) : undefined };
    }
  }

  private lastAssistantText = "";

  async buildJsonEnvelope(result: PromptResult): Promise<unknown> {
    const sessionId = this.sessions.sessionId;
    let review: any;
    if (sessionId) {
      try { review = await buildReview(this.root, this.store, sessionId, featureEnabled(this.config, "git_context")); }
      catch { review = undefined; }
    }
    return {
      sessionId: sessionId ?? null,
      runId: result.runId ?? null,
      status: result.ok ? "completed" : this.kernel?.runState?.stage === "blocked" ? "blocked" : "failed",
      result: result.result,
      tasks: sessionId ? this.store.listTasks(sessionId) : [],
      evidence: review?.Tested ?? [],
      remainingRisk: review?.RemainingRisk ?? [],
      error: result.error ? result.error instanceof Error ? result.error.message : String(result.error) : undefined,
    };
  }

  async verificationExitCode(runId?: string): Promise<number> {
    const sessionId = this.sessions.sessionId;
    if (!sessionId) return 0;
    const assessment = await assessVerification(this.root, this.store, sessionId, runId);
    return assessment.satisfied ? 0 : 3;
  }

  async statusObject(): Promise<unknown> {
    const sessionId = this.sessions.sessionId;
    const tasks = sessionId ? this.store.listTasks(sessionId) : [];
    const assessment = sessionId ? await assessVerification(this.root, this.store, sessionId) : undefined;
    const manifest = this.kernel?.lastManifest;
    return {
      sessionId: sessionId ?? null,
      model: this.modelAlias,
      repository: await gitState(this.root),
      run: this.kernel?.runState?.stage ?? "idle",
      context: manifest ? { estimatedPromptTokens: manifest.estimatedPromptTokens, contextWindow: manifest.contextWindow } : null,
      mutationLock: this.locks.mutationOwned,
      authorization: { edits: this.authorized.has("edits"), shell: this.authorized.has("shell") },
      tasks: { total: tasks.length, done: tasks.filter(t => t.status === "completed" || t.status === "skipped").length, active: tasks.find(t => t.status === "in_progress")?.id },
      evidence: assessment?.latest ? { id: assessment.latest.id, status: assessment.latest.status, fresh: assessment.latest.fresh } : null,
      unknownExecutions: sessionId ? this.store.unknownExecutions(sessionId).length : 0,
      jev: {
        enabled: this.config.features.jev_harness && this.config.internal_models.jev.enabled,
        mode: this.config.internal_models.jev.mode,
        model: this.config.internal_models.jev.model,
        metrics: sessionId ? this.store.decisionMetrics(sessionId) : { total: 0, success: 0, byKind: {}, byStatus: {}, averageLatencyMs: null },
      },
    };
  }

  async settings(): Promise<unknown> { return redactConfig(this.config); }

  async context(filesOnly: boolean): Promise<unknown> {
    const sessionId = this.requireSession("No active session. Send a prompt, use /clear, or /resume <sessionId>.");
    const manifest = await new ManifestStore(this.root, sessionId).load();
    return filesOnly ? { included: manifest?.includedFragments ?? [], omitted: manifest?.omissions ?? [] } : manifest;
  }

  tasks(): unknown[] {
    if (!featureEnabled(this.config, "task_engine")) throw new Error("task_engine unavailable: feature disabled");
    return this.store.listTasks(this.requireSession("No active session. Send a prompt, use /clear, or /resume <sessionId>."));
  }

  decisions(limit: number): unknown {
    const sessionId = this.requireSession("No active session. Send a prompt, use /clear, or /resume <sessionId>.");
    const boundedLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
    return { enabled: this.config.features.jev_harness && this.config.internal_models.jev.enabled, metrics: this.store.decisionMetrics(sessionId), events: this.store.listDecisionEvents(sessionId, boundedLimit) };
  }

  metrics(): unknown { return this.store.metricSummary(this.sessions.sessionId); }

  async diff(): Promise<unknown> {
    if (!featureEnabled(this.config, "git_context")) throw new Error("git_context unavailable: feature disabled");
    const state = await gitState(this.root);
    return { state, diff: state.isGit ? await gitDiff(this.root) : null };
  }

  async review(): Promise<unknown> {
    const sessionId = this.requireSession("No active session. Send a prompt, use /clear, or /resume <sessionId>.");
    return buildReview(this.root, this.store, sessionId, featureEnabled(this.config, "git_context"));
  }

  async switchModel(alias: string): Promise<void> {
    if (!(alias in this.config.models.aliases)) throw new Error("Unknown trusted model alias " + alias);
    if (this.kernel) await this.kernel.switchModel(alias);
    this.modelAlias = alias;
  }

  authorize(scope: string): string {
    if (!["edits", "shell", "all"].includes(scope)) throw new Error("Usage: /authorize edits|shell|all");
    if (scope === "all" || scope === "edits") this.authorized.add("edits");
    if (scope === "all" || scope === "shell") this.authorized.add("shell");
    this.kernel?.authorize(scope as "edits" | "shell" | "all");
    return scope === "shell" || scope === "all" ? "Authorized. Repository shell scripts are not OS-sandboxed." : "Authorized workspace edits for this session.";
  }

  async compact(): Promise<void> {
    const kernel = await this.ensureKernel();
    await kernel.compact("Preserve user goal, constraints, current task, unresolved failures, pending work and unknown executions.");
  }

  async checkpointList(): Promise<unknown[]> {
    if (!this.config.features.checkpoint) throw new Error("checkpoint unavailable: feature disabled");
    return listCheckpoints(this.store, this.requireSession("No active session. Send a prompt, use /clear, or /resume <sessionId>."));
  }

  async createCheckpoint(): Promise<string> {
    if (!this.config.features.checkpoint) throw new Error("checkpoint unavailable: feature disabled");
    const sessionId = this.requireSession("No active session. Send a prompt, use /clear, or /resume <sessionId>.");
    const started = performance.now();
    const continuity = this.continuity(sessionId);
    const transcriptRef = this.kernel?.transcriptRef ?? this.pendingTranscriptRef ?? currentTranscriptRef(this.root, sessionId);
    const checkpoint = await continuity.createCheckpoint({ transcriptRef, goal: this.kernel?.currentGoalForCheckpoint });
    this.store.recordMetric({ sessionId, name: "checkpoint.create_ms", value: performance.now() - started });
    return checkpoint;
  }

  async restoreCheckpoint(checkpointId: string): Promise<unknown> {
    if (!this.config.features.checkpoint) throw new Error("checkpoint unavailable: feature disabled");
    const sessionId = this.requireSession("No active session. Send a prompt, use /clear, or /resume <sessionId>.");
    await this.disposeKernel();
    await this.locks.release();
    await this.locks.ensureMutationAccess();
    try {
      const started = performance.now();
      const { checkpoint, restored, recovery } = await this.continuity(sessionId).restore(checkpointId);
      this.store.recordMetric({ sessionId, name: "checkpoint.restore_ms", value: performance.now() - started });
      this.pendingTranscriptRef = checkpoint.transcriptRef;
      this.authorized.clear();
      return { restored, recovery, sourceRollback: false };
    } finally { await this.locks.release(); }
  }

  async clear(): Promise<string> {
    await this.disposeKernel();
    await this.locks.release();
    const sessionId = this.sessions.createNew();
    this.pendingTranscriptRef = undefined;
    this.authorized.clear();
    return sessionId;
  }

  async resume(sessionId: string): Promise<unknown> { return this.resumeSession(sessionId); }

  trustStatus(): unknown {
    const sessionId = this.requireSession("No active session. Send a prompt, use /clear, or /resume <sessionId>.");
    const baseline = this.store.trustedCommandSnapshot(sessionId);
    const current = captureTrustedCommandSnapshot(this.root);
    const diff = diffTrustedCommandSnapshots(baseline, current);
    return {
      baselineDigest: trustedSnapshotDigest(baseline), currentDigest: trustedSnapshotDigest(current),
      changed: diff.changedSources.length > 0 || diff.addedCommands.length > 0 || diff.removedCommands.length > 0,
      ...diff, commands: Object.keys(baseline?.commands ?? {}).sort(),
    };
  }

  refreshTrust(): unknown {
    const sessionId = this.requireSession("No active session. Send a prompt, use /clear, or /resume <sessionId>.");
    const snapshot = this.store.refreshTrustedCommandSnapshot(sessionId, this.root);
    const commands = Object.keys(snapshot.commands).sort();
    return { refreshed: true, digest: trustedSnapshotDigest(snapshot), commands };
  }

  async executeCommand(name: string, args: string[], json: boolean, io: CommandIO): Promise<void> {
    const command = this.registry.get(name);
    if (!command) throw new Error("Unknown command: " + name);
    await command.execute({ json, args, ...io });
  }

  async dispose(): Promise<void> {
    await this.disposeKernel();
    await this.locks.release();
    this.store.close();
  }

  private requireSession(message: string): string {
    const sessionId = this.sessions.sessionId;
    if (!sessionId) throw new Error(message);
    return sessionId;
  }

  private continuity(sessionId: string): DurableContinuity {
    return new DurableContinuity(this.root, this.repoId, this.store, sessionId, featureEnabled(this.config, "context_ledger"));
  }

  private async ensureKernel(): Promise<PiAgentKernel> {
    const sessionId = this.sessions.ensure();
    if (this.kernel && this.kernelSessionId !== sessionId) await this.disposeKernel();
    if (!this.kernel) {
      const started = performance.now();
      this.kernel = new PiAgentKernel(this.root, this.config, sessionId, this.store, this.modelAlias, () => this.locks.ensureMutationAccess());
      await this.kernel.create(event => {
        if (event.text) { this.lastAssistantText += event.text; this.onAssistantText?.(event.text); }
      });
      this.kernelSessionId = sessionId;
      if (this.pendingTranscriptRef) { await this.kernel.branchTranscript(this.pendingTranscriptRef); this.pendingTranscriptRef = undefined; }
      if (this.authorized.has("edits")) this.kernel.authorize("edits");
      if (this.authorized.has("shell")) this.kernel.authorize("shell");
      this.store.recordMetric({ sessionId, name: "kernel.create_ms", value: performance.now() - started });
    }
    this.lastAssistantText = "";
    return this.kernel;
  }

  private async disposeKernel(): Promise<void> {
    if (this.kernel) { await this.kernel.dispose(); this.kernel = undefined; this.kernelSessionId = undefined; }
  }

  private async resumeSession(sessionId: string): Promise<unknown> {
    await this.disposeKernel();
    await this.locks.release();
    await this.locks.ensureMutationAccess();
    try {
      this.sessions.resume(sessionId);
      const started = performance.now();
      const { checkpoints, recovery } = await this.continuity(sessionId).reconcileResume(featureEnabled(this.config, "checkpoint"));
      this.store.recordMetric({ sessionId, name: "recovery.duration_ms", value: performance.now() - started });
      this.pendingTranscriptRef = undefined;
      this.authorized.clear();
      return { recovery, checkpoints };
    } finally { await this.locks.release(); }
  }
}

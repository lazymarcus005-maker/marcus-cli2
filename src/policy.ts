import path from "node:path";
import { chmod, open, readFile, realpath, rename, stat, writeFile, readdir, unlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { StateStore } from "./storage/state.js";
import type { MacusConfig } from "./types.js";
import { ensureDir, fileHash, id, stripAnsiAndControls, sha256 } from "./utils.js";
import { PathPolicy } from "./path-policy.js";
import { noteWorkspaceWrite } from "./testing/snapshot-store.js";

export interface CommandResult {
  executionId: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  cancelled: boolean;
  outputComplete: boolean;
  truncated: boolean;
  stdout: string;
  stderr: string;
  logRef?: string;
}

export class PolicyExecutor {
  private editsAuthorized = false;
  private shellAuthorized = false;
  private readonly pathPolicy: PathPolicy;
  private readonly credentialEnvNames: Set<string>;
  private readonly redactedValues: string[];

  constructor(
    readonly root: string,
    readonly sessionId: string,
    readonly store: StateStore,
    readonly config: MacusConfig,
    readonly ensureMutationAccess?: () => Promise<void>,
  ) {
    this.pathPolicy = new PathPolicy(root);
    const jevCredential=(config.features.jev_harness&&config.internal_models.jev.enabled)
      ?config.internal_models.jev.api_key_env
      :undefined;
    this.credentialEnvNames = new Set([
      ...Object.values(config.models.providers).map(p => p.api_key_env).filter((x): x is string => Boolean(x)),
      jevCredential,
    ].filter((x): x is string => Boolean(x)));
    const sensitiveNames = new Set([
      ...this.credentialEnvNames,
      ...config.execution.environment_allowlist.filter(n => /(?:KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL)/i.test(n)),
    ]);
    this.redactedValues = [...sensitiveNames]
      .map(name => process.env[name])
      .filter((value): value is string => Boolean(value && value.length >= 4))
      .sort((a, b) => b.length - a.length);
  }

  authorize(scope: "edits" | "shell" | "all"): void {
    if (scope === "edits" || scope === "all") this.editsAuthorized = true;
    if (scope === "shell" || scope === "all") this.shellAuthorized = true;
  }

  authorizePath(input: string): string {
    return this.pathPolicy.lexical(input);
  }

  private redactSecrets(input: string): string {
    let out = input;
    for (const value of this.redactedValues) out = out.split(value).join("[REDACTED]");
    return out;
  }

  async safeRead(input: string): Promise<{ content: string; hash: string }> {
    const { absolute } = await this.pathPolicy.resolveReadable(input);
    const content = await readFile(absolute, "utf8");
    return { content, hash: (await fileHash(absolute))! };
  }

  async safeWrite(input: string, content: string, expectedHash: string | null, journal: { runId?: string; toolCallId?: string } = {}): Promise<{ beforeHash: string | null; afterHash: string }> {
    if (!this.editsAuthorized) throw new Error("Workspace edits require explicit user authorization for this session");
    await this.ensureMutationAccess?.();
    const resolved = this.authorizePath(input);
    const parent = path.dirname(resolved);
    await ensureDir(parent);
    const canonicalRoot = await realpath(this.root);
    const canonicalParent = await realpath(parent);
    const parentRel = path.relative(canonicalRoot, canonicalParent);
    if (parentRel.startsWith("..") || path.isAbsolute(parentRel)) throw new Error("Write parent escapes workspace through symlink");

    const beforeHash = await fileHash(resolved);
    if (expectedHash !== beforeHash) throw new Error(`Source changed before write: ${input}`);

    const execId = id("exec");
    this.store.prepareExecution({
      executionId: execId,
      sessionId: this.sessionId,
      runId: journal.runId,
      toolCallId: journal.toolCallId,
      effectClass: "workspace_edit",
      cwd: this.root,
      beforeHash: beforeHash ?? undefined,
      payload: { path: input, expectedAfterHash: sha256(content) },
    });
    this.store.markExecution(execId, "started");

    const tmp = `${resolved}.macus-tmp-${process.pid}-${Date.now()}`;
    let committed = false;
    try {
      let mode: number | undefined;
      try { mode = (await stat(resolved)).mode; } catch {}
      await writeFile(tmp, content, "utf8");
      if (mode !== undefined) await chmod(tmp, mode);

      // Revalidate immediately before the atomic rename. This closes the normal
      // external-editor TOCTOU window between read/prepare and commit.
      const currentHash = await fileHash(resolved);
      if (currentHash !== beforeHash) throw new Error(`Source changed before commit: ${input}`);

      await rename(tmp, resolved);
      committed = true;
      const afterHash = (await fileHash(resolved))!;
      await noteWorkspaceWrite(this.root,resolved,afterHash);
      this.store.markExecution(execId, "completed", { afterHash });
      return { beforeHash, afterHash };
    } catch (error) {
      if (!committed) {
        try { this.store.markExecution(execId, "failed", { outputComplete: true }); } catch {}
      }
      throw error;
    } finally {
      if (!committed) await unlink(tmp).catch(() => {});
    }
  }

  private async enforceLogRetention(protect?: string): Promise<void> {
    const root = path.join(this.root, ".macus", "logs");
    await ensureDir(root);
    const files: Array<{ path: string; mtime: number; size: number }> = [];
    const walk = async (dir: string): Promise<void> => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile()) {
          const st = await stat(p);
          files.push({ path: p, mtime: st.mtimeMs, size: st.size });
        }
      }
    };
    await walk(root);
    const cutoff = Date.now() - this.config.logs.retention_days * 86400000;
    for (const f of files) {
      if (f.path !== protect && f.mtime < cutoff) {
        await unlink(f.path).catch(() => {});
        f.size = 0;
      }
    }
    let total = files.reduce((n, f) => n + f.size, 0);
    for (const f of files.filter(f => f.size > 0 && f.path !== protect).sort((a, b) => a.mtime - b.mtime)) {
      if (total <= this.config.logs.max_total_bytes) break;
      await unlink(f.path).catch(() => {});
      total -= f.size;
    }
  }

  async run(command: string, opts: { cwd?: string; timeoutSeconds?: number; signal?: AbortSignal; effectClass?: string; runId?: string; toolCallId?: string } = {}): Promise<CommandResult> {
    if (!this.shellAuthorized) throw new Error("Shell execution requires explicit user authorization for this session; repository scripts are not OS-sandboxed");
    await this.ensureMutationAccess?.();

    const lexicalCwd = opts.cwd ? this.authorizePath(opts.cwd) : this.root;
    const canonicalRoot = await realpath(this.root);
    const cwd = await realpath(lexicalCwd);
    const cwdRel = path.relative(canonicalRoot, cwd);
    if (cwdRel.startsWith("..") || path.isAbsolute(cwdRel)) throw new Error("Command cwd escapes workspace through symlink");

    const effectClass = opts.effectClass ?? "shell";
    const timeoutCeiling = effectClass === "test_build"
      ? this.config.execution.test_build_timeout_seconds
      : this.config.execution.command_timeout_seconds;
    const requestedTimeout = opts.timeoutSeconds ?? timeoutCeiling;
    const timeoutSeconds = Math.max(1, Math.min(requestedTimeout, timeoutCeiling));

    const executionId = id("exec");
    if (opts.signal?.aborted) {
      const persistedCommand = this.redactSecrets(command);
      this.store.prepareExecution({
        executionId, sessionId: this.sessionId, runId: opts.runId, toolCallId: opts.toolCallId, command: persistedCommand, cwd, effectClass, payload: { command: persistedCommand },
      });
      this.store.markExecution(executionId, "cancelled", { cancelled: true, outputComplete: true });
      return { executionId, exitCode: null, signal: null, timedOut: false, cancelled: true, outputComplete: true, truncated: false, stdout: "", stderr: "" };
    }
    const logsDir = path.join(this.root, ".macus", "logs", this.sessionId);
    await ensureDir(logsDir);
    await this.enforceLogRetention();
    const logPath = path.join(logsDir, `${executionId}.log`);
    const logStream = createWriteStream(logPath, { flags: "w", mode: 0o600 });

    const persistedCommand = this.redactSecrets(command);
    this.store.prepareExecution({
      executionId,
      sessionId: this.sessionId,
      runId: opts.runId,
      toolCallId: opts.toolCallId,
      command: persistedCommand,
      cwd,
      effectClass,
      payload: { command: persistedCommand },
    });
    this.store.markExecution(executionId, "started");

    const allowedEnv: Record<string, string> = {};
    for (const name of this.config.execution.environment_allowlist) {
      if (this.credentialEnvNames.has(name)) continue;
      const v = process.env[name];
      if (v !== undefined) allowedEnv[name] = v;
    }

    const child = spawn("/bin/sh", ["-lc", command], {
      cwd,
      env: allowedEnv,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const maxMem = this.config.execution.max_output_memory_bytes;
    const maxLog = this.config.execution.max_log_bytes;
    const chunksOut: Buffer[] = [];
    const chunksErr: Buffer[] = [];
    let memoryBytes = 0;
    let logBytes = 0;
    let truncated = false;
    const pending: Record<"stdout" | "stderr", string> = { stdout: "", stderr: "" };
    const keepTail = this.redactedValues.length ? Math.max(...this.redactedValues.map(v => v.length)) : 0;

    const emitSanitized = (target: Buffer[], text: string, label: "stdout" | "stderr") => {
      if (!text) return;
      const safe = Buffer.from(this.redactSecrets(stripAnsiAndControls(text)), "utf8");
      if (memoryBytes < maxMem) {
        const remaining = maxMem - memoryBytes;
        const part = safe.subarray(0, remaining);
        target.push(part);
        memoryBytes += part.length;
        if (part.length < safe.length) truncated = true;
      } else if (safe.length) truncated = true;

      if (logBytes < maxLog && safe.length) {
        const prefix = Buffer.from(`[${label}] `);
        const prefixRoom = Math.max(0, maxLog - logBytes);
        const prefixPart = prefix.subarray(0, prefixRoom);
        if (prefixPart.length) {
          logStream.write(prefixPart);
          logBytes += prefixPart.length;
        }
        const remaining = Math.max(0, maxLog - logBytes);
        const part = safe.subarray(0, remaining);
        if (part.length) {
          logStream.write(part);
          logBytes += part.length;
        }
        if (prefixPart.length < prefix.length || part.length < safe.length) truncated = true;
      } else if (safe.length) truncated = true;
    };

    const feed = (target: Buffer[], chunk: Buffer | undefined, label: "stdout" | "stderr", final = false) => {
      if (chunk) pending[label] += chunk.toString("utf8");
      const keep = final ? 0 : keepTail;
      const emitLength = Math.max(0, pending[label].length - keep);
      if (emitLength === 0 && !final) return;
      const emit = final ? pending[label] : pending[label].slice(0, emitLength);
      pending[label] = final ? "" : pending[label].slice(emitLength);
      emitSanitized(target, emit, label);
    };

    child.stdout?.on("data", (c: Buffer) => feed(chunksOut, c, "stdout"));
    child.stderr?.on("data", (c: Buffer) => feed(chunksErr, c, "stderr"));

    let timedOut = false;
    let cancelled = false;
    let exited = false;
    let killTimer: NodeJS.Timeout | undefined;

    const exitPromise = new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        exited = true;
        resolve([code, signal]);
      });
    });

    const requestTermination = (kind: "timeout" | "cancel") => {
      if (kind === "timeout") timedOut = true;
      else cancelled = true;
      if (exited) return;
      try { process.kill(-child.pid!, "SIGTERM"); } catch {}
      if (!killTimer) {
        killTimer = setTimeout(() => {
          if (!exited) {
            try { process.kill(-child.pid!, "SIGKILL"); } catch {}
          }
        }, 1000 * this.config.execution.termination_grace_seconds);
      }
    };

    const timer = setTimeout(() => requestTermination("timeout"), timeoutSeconds * 1000);
    const onAbort = () => requestTermination("cancel");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    if (opts.signal?.aborted) onAbort();

    let code: number | null = null;
    let signal: NodeJS.Signals | null = null;
    try {
      [code, signal] = await exitPromise;
    } catch (error) {
      this.store.markExecution(executionId, "failed", { outputComplete: false });
      throw error;
    } finally {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      opts.signal?.removeEventListener("abort", onAbort);
      feed(chunksOut, undefined, "stdout", true);
      feed(chunksErr, undefined, "stderr", true);
      await new Promise<void>((resolve, reject) => {
        logStream.once("error", reject);
        logStream.end(() => resolve());
      });
    }

    await this.enforceLogRetention(logPath);
    const stdout = Buffer.concat(chunksOut).toString("utf8");
    const stderr = Buffer.concat(chunksErr).toString("utf8");
    const status = cancelled ? "cancelled" : timedOut ? "failed" : code === 0 ? "completed" : "failed";
    this.store.markExecution(executionId, status, {
      exitCode: code,
      signal: signal ?? null,
      timedOut,
      cancelled,
      outputComplete: !truncated,
      truncated,
      logRef: executionId,
    });
    return {
      executionId,
      exitCode: code,
      signal: signal ?? null,
      timedOut,
      cancelled,
      outputComplete: !truncated,
      truncated,
      stdout,
      stderr,
      logRef: executionId,
    };
  }

  async readLog(logRef: string, start = 0, maxBytes = 64 * 1024): Promise<{ text: string; next?: number }> {
    if (!/^exec_[0-9a-f-]+$/i.test(logRef)) throw new Error("Invalid log reference");
    const file = path.join(this.root, ".macus", "logs", this.sessionId, `${logRef}.log`);
    let handle;
    try { handle = await open(file, "r"); }
    catch (error: any) {
      if (error?.code === "ENOENT") throw new Error(`Log expired or missing: ${logRef}`);
      throw error;
    }
    try {
      const buf = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buf, 0, maxBytes, start);
      return {
        text: this.redactSecrets(stripAnsiAndControls(buf.subarray(0, bytesRead).toString("utf8"))),
        next: bytesRead === maxBytes ? start + bytesRead : undefined,
      };
    } finally {
      await handle.close();
    }
  }
}

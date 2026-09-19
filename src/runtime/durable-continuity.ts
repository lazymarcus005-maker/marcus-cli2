import { ContextLedger } from "../context/ledger.js";
import { createCheckpoint, loadCheckpoint, reconcileCheckpoints, restoreCheckpoint } from "../storage/checkpoint.js";
import { StateStore } from "../storage/state.js";
import { currentTranscriptRef, readTranscriptCorrelation } from "../storage/transcript.js";
import { reconcileExecutions } from "../storage/recovery.js";

/** Keeps checkpoint capture and recovery ordering local to durable session continuity. */
export class DurableContinuity {
  constructor(
    readonly root: string,
    readonly repoIdentity: string,
    readonly store: StateStore,
    readonly sessionId: string,
    readonly ledgerEnabled: boolean,
  ) {}

  async createCheckpoint(args: { transcriptRef?: string; goal?: string; nextAction?: string; changedFiles?: Array<{path:string;hash:string}> } = {}): Promise<string> {
    const ledger = this.ledgerEnabled ? new ContextLedger(this.store, this.sessionId).latest() : undefined;
    return createCheckpoint(this.root, this.store, {
      schemaVersion: 1,
      sessionId: this.sessionId,
      repoIdentity: this.repoIdentity,
      root: this.root,
      transcriptRef: args.transcriptRef ?? currentTranscriptRef(this.root, this.sessionId),
      stateRevision: ledger?.revision ?? 0,
      goal: args.goal ?? ledger?.state.goal,
      tasks: this.store.listTasks(this.sessionId),
      decisions: ledger?.state.decisions ?? [],
      changedFiles: ledger?.state.workingFiles ?? args.changedFiles ?? [],
      evidence: this.store.listEvidence(this.sessionId, 20).map(row => ({
        id: row.id, status: row.status, snapshotDigest: row.snapshotDigest, payload: row.payload,
      })),
      nextAction: ledger?.state.nextAction ?? args.nextAction,
      unknownExecutions: this.store.unknownExecutions(this.sessionId),
    });
  }

  async reconcileResume(checkpointsEnabled = true): Promise<{ checkpoints?: Awaited<ReturnType<typeof reconcileCheckpoints>>; recovery: Awaited<ReturnType<typeof reconcileExecutions>> }> {
    const checkpoints = checkpointsEnabled ? await reconcileCheckpoints(this.root, this.store, this.sessionId) : undefined;
    const correlation = readTranscriptCorrelation(this.root, this.sessionId);
    const recovery = await reconcileExecutions(this.root, this.store, this.sessionId, correlation);
    return { checkpoints, recovery };
  }

  async restore(checkpointId: string): Promise<{ checkpoint: Awaited<ReturnType<typeof loadCheckpoint>>; restored: Awaited<ReturnType<typeof restoreCheckpoint>>; recovery: Awaited<ReturnType<typeof reconcileExecutions>> }> {
    const checkpoint = await loadCheckpoint(this.store, checkpointId);
    const currentTranscript = readTranscriptCorrelation(this.root, this.sessionId);
    if (!checkpoint.transcriptRef && currentTranscript.entryIds.size) {
      throw new Error("Checkpoint lacks transcriptRef and cannot be selected safely for a non-empty Pi transcript");
    }
    const correlation = readTranscriptCorrelation(this.root, this.sessionId, checkpoint.transcriptRef);
    const restored = await restoreCheckpoint({
      root: this.root,
      store: this.store,
      sessionId: this.sessionId,
      repoIdentity: this.repoIdentity,
      checkpointId,
    });
    const recovery = await reconcileExecutions(this.root, this.store, this.sessionId, correlation);
    return { checkpoint, restored, recovery };
  }
}

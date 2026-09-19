import { StateStore } from "../storage/state.js";
import { gitState, repositoryIdentity } from "../repository.js";
import { snapshotDigest } from "../testing/evidence.js";

export interface TestedEvidenceView {
  id: string;
  status: string;
  snapshotDigest: string;
  fresh: boolean;
  identityFresh: boolean;
  detail: any;
}

export interface TaskEvidenceView {
  id: string;
  status: string;
  evidenceIds: string[];
  verified: boolean;
}

export interface VerificationAssessment {
  required: boolean;
  satisfied: boolean;
  reason: "no_verification_required" | "evidence_missing" | "latest_evidence_failed" | "latest_evidence_unknown" | "latest_evidence_stale" | "completed_task_unverified" | "verified";
  runId?: string;
  changedDuringRun: boolean;
  latest?: TestedEvidenceView;
  tested: TestedEvidenceView[];
  taskEvidence: TaskEvidenceView[];
  remainingRisk: string[];
  unresolvedIssue: Array<{id:string;title:string}>;
}

/** Produces the single current interpretation of test evidence for review and CLI completion. */
export async function assessVerification(
  root: string,
  store: StateStore,
  sessionId: string,
  requestedRunId?: string,
): Promise<VerificationAssessment> {
  const runId = requestedRunId ?? store.latestRunId(sessionId);
  const [git, repoIdentity] = await Promise.all([gitState(root), repositoryIdentity(root)]);
  const evidence = store.listEvidence(sessionId);
  const currentSnapshot = evidence.length ? await snapshotDigest(root) : undefined;
  const tested: TestedEvidenceView[] = evidence.map(record => {
    const detail = record.payload ?? {};
    const identityFresh = detail.repoIdentity === repoIdentity && detail.head === git.head;
    return {
      id: record.id,
      status: record.status,
      snapshotDigest: record.snapshotDigest,
      fresh: currentSnapshot === record.snapshotDigest && identityFresh,
      identityFresh,
      detail,
    };
  });
  const latest = tested[0];
  const completedEdits = store.completedWorkspaceEditPayloads(sessionId, runId);
  const changedDuringRun = completedEdits.length > 0;
  const tasks = store.listTasks(sessionId);
  const completedTasks = tasks.filter(task => task.status === "completed");
  const evidenceById = new Map(tested.map(item => [item.id, item]));
  const taskEvidence: TaskEvidenceView[] = tasks.map(task => {
    const linked = task.evidenceIds.map(id => evidenceById.get(id)).filter((item): item is TestedEvidenceView => Boolean(item));
    return {
      id: task.id,
      status: task.status,
      evidenceIds: task.evidenceIds,
      verified: task.status === "completed" && linked.some(item => item.status === "passed" && item.fresh),
    };
  });
  const unverifiedTasks = taskEvidence.filter(task => task.status === "completed" && !task.verified);
  const required = changedDuringRun || completedTasks.length > 0 || tested.length > 0;

  let reason: VerificationAssessment["reason"];
  if (!required) reason = "no_verification_required";
  else if (!latest) reason = "evidence_missing";
  else if (latest.status === "failed") reason = "latest_evidence_failed";
  else if (latest.status !== "passed") reason = "latest_evidence_unknown";
  else if (!latest.fresh) reason = "latest_evidence_stale";
  else if (unverifiedTasks.length) reason = "completed_task_unverified";
  else reason = "verified";

  const remainingRisk: string[] = [];
  if (!latest) remainingRisk.push("No structured test evidence recorded for this session.");
  else if (latest.status !== "passed" || !latest.fresh) {
    remainingRisk.push("Latest test evidence is failed, unknown, incomplete, stale, or belongs to a different repository/HEAD snapshot.");
  }
  for (const task of unverifiedTasks) {
    remainingRisk.push(`Completed task ${task.id} has no linked passing evidence that is fresh.`);
  }
  if (tasks.some(task => task.status !== "completed" && task.status !== "skipped")) {
    remainingRisk.push("Not all durable tasks are completed or skipped.");
  }

  return {
    required,
    satisfied: !required || reason === "verified",
    reason,
    runId,
    changedDuringRun,
    latest,
    tested,
    taskEvidence,
    remainingRisk: [...new Set(remainingRisk)],
    unresolvedIssue: tasks.filter(task => task.status === "blocked").map(task => ({ id: task.id, title: task.title })),
  };
}

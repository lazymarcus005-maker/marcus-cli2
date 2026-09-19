import type { TestEvidence } from "../testing/evidence.js";

export type ToolOutcome =
  | { kind: "test"; toolName: "run_test"; input: Record<string, unknown>; evidence: TestEvidence; isError: boolean; text: string }
  | { kind: "command"; toolName: "run_command"; input: Record<string, unknown>; result: Record<string, unknown>; evidence?: TestEvidence; isError: boolean; text: string }
  | { kind: "write"; toolName: "write_file"; input: Record<string, unknown>; result: Record<string, unknown>; isError: boolean; text: string }
  | { kind: "task"; toolName: "task_create" | "task_transition"; input: Record<string, unknown>; result: Record<string, unknown>; isError: boolean; text: string }
  | { kind: "review"; toolName: "review"; input: Record<string, unknown>; review: Record<string, unknown>; isError: boolean; text: string }
  | { kind: "discovery"; toolName: string; input: Record<string, unknown>; isError: boolean; text: string }
  | { kind: "other"; toolName: string; input: Record<string, unknown>; details: unknown; isError: boolean; text: string };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asTestEvidence(value: unknown): TestEvidence {
  const raw = record(value);
  const status = raw.status === "passed" || raw.status === "failed" || raw.status === "unknown" || raw.status === "not_run"
    ? raw.status : "unknown";
  return { ...raw, status } as TestEvidence;
}

function eventText(event: Record<string, unknown>): string {
  if (!Array.isArray(event.content)) return "";
  return event.content.flatMap(item => {
    const content = record(item);
    return content.type === "text" && typeof content.text === "string" ? [content.text] : [];
  }).join("\n");
}

/** Converts Pi's event shape to the outcome vocabulary used by orchestration and Jev. */
export function normalizeToolOutcome(value: unknown): ToolOutcome {
  const event = record(value);
  const toolName = typeof event.toolName === "string" ? event.toolName : "unknown_tool";
  const input = record(event.input);
  const details = event.details;
  const detailRecord = record(details);
  const text = eventText(event);
  const isError = event.isError === true;
  switch (toolName) {
    case "run_test":
      return { kind: "test", toolName, input, evidence: asTestEvidence(details), isError, text };
    case "run_command":
      return { kind: "command", toolName, input, result: record(detailRecord.command), evidence: detailRecord.evidence ? asTestEvidence(detailRecord.evidence) : undefined, isError, text };
    case "write_file":
      return { kind: "write", toolName, input, result: detailRecord, isError, text };
    case "task_create":
    case "task_transition":
      return { kind: "task", toolName, input, result: detailRecord, isError, text };
    case "review":
      return { kind: "review", toolName, input, review: detailRecord, isError, text };
    case "search_code":
    case "read_range":
    case "search_symbol":
    case "repo_map":
    case "git_state":
    case "git_diff":
    case "git_log":
    case "git_show":
    case "git_blame":
      return { kind: "discovery", toolName, input, isError, text };
    default:
      return { kind: "other", toolName, input, details, isError, text };
  }
}

export function outcomeFailed(outcome: ToolOutcome): boolean {
  if (outcome.isError) return true;
  if (outcome.kind === "test") return outcome.evidence.status !== "passed";
  if (outcome.kind === "command") {
    return outcome.result.exitCode !== 0 || outcome.result.timedOut === true || outcome.result.cancelled === true ||
      Boolean(outcome.evidence && outcome.evidence.status !== "passed");
  }
  return false;
}

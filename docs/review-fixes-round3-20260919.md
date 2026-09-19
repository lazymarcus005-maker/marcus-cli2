# Code Review Remediation Round 3 — 2026-09-19

Scope: follow-up findings after the 59/59-test remediation state.

## Result

All findings from the third review pass now have production-path changes and regression evidence.

| # | Finding | Remediation | Evidence |
| --- | --- | --- | --- |
| 1 | Structured test evidence could be forged/reused or read outside the workspace | run_test now classifies discovered project test/build commands, never promotes undiscovered commands to passed, validates report paths through PathPolicy, requires a report to be created/modified by the current run, bounds report size, and records trust metadata | tests/test-evidence-trust.test.ts |
| 2 | Source freshness applied only to read_range | search_code results now carry source hashes; context runtime revalidates search_code/search_symbol/repo_map before every provider request and omits stale source | tests/context-search-freshness.test.ts |
| 3 | Execution journal dropped durable runId and Pi toolCallId | PolicyExecutor accepts journal metadata and write_file/run_command/run_test forward runId + toolCallId | tests/execution-correlation.test.ts |
| 4 | Test evidence freshness ignored repository identity and Git HEAD | Evidence records repoIdentity + HEAD; review requires snapshot + identity + HEAD freshness | tests/evidence-identity-task.test.ts |
| 5 | Task evidenceIds were not used by workflow/review | run_test attaches evidence to the in-progress task; review requires completed tasks to have fresh passing linked evidence | tests/end-to-end-workflow.test.ts, tests/evidence-identity-task.test.ts |
| 6 | gitDiff omitted staged changes | gitDiff now returns bounded staged and unstaged sections | tests/git-staged-unborn.test.ts |
| 7 | Request manifest misclassified search source as generic tool output | Context selector tracks search/repo-map/working-source fragments separately and reclassifies manifest categories from the actual selected fragments | tests/context-search-freshness.test.ts |
| 8 | Checkpoint had no production list/select/restore flow | /checkpoint supports create, list and select; restore validates session/repository/worktree identity, re-hashes files, restores durable task/ledger state, and never rolls back source bytes | tests/checkpoint-restore.test.ts |
| 9 | Ledger decisions had no production writer and were overwritten by later revisions | Added decision_record agent tool with provenance; runtime ledger persistence preserves previous decisions; checkpoints include current evidence/decisions | tests/checkpoint-restore.test.ts |
| 10 | Unborn Git repository was reported as non-Git | gitState detects worktree independently from HEAD existence and exposes undefined HEAD for unborn repositories | tests/git-staged-unborn.test.ts |
| 11 | Snapshot/report processing used unbounded full-file reads | Workspace snapshot hashing streams file content; structured report parsing rejects reports above the configured bounded memory ceiling | tests/test-evidence-trust.test.ts |

## Trusted test evidence policy

A successful command is not sufficient to create passing evidence.

Macus V1 now treats a test/build command as trusted only when it is discovered from project configuration:
- package.json scripts named test*, build*, check*, typecheck or lint;
- dotnet test <sln/csproj> for discovered .NET project files.

An undiscovered command may still run through the authorized shell path, but its evidence remains unknown even if it emits a syntactically green JUnit/TRX report.

For structured evidence, the report must:
1. resolve inside the workspace through PathPolicy;
2. not target denied secret/internal paths;
3. be created or modified by the current run;
4. stay under the bounded report-size ceiling;
5. parse completely;
6. correspond to a stable tested snapshot, repository identity and Git HEAD.

## Context-source freshness

Before each provider request, Macus now revalidates source-bearing tool results:
- read_range by source hash;
- search_code by per-match source hash;
- search_symbol by source hash;
- repo_map by repository source generation.

Stale historical source is replaced with a protocol-preserving omission marker. Request manifests record selected search_results, repo_map and working_source categories rather than reporting all of them as generic tool output.

## Recovery correlation

Execution journal records now retain:
- sessionId;
- runId;
- Pi toolCallId;
- effect class;
- command/redacted payload;
- pre/post hashes and execution result.

This gives recovery code a stable correlation key to reconcile durable intent/result rows with the Pi transcript rather than relying only on filesystem heuristics.

## Checkpoint restore behavior

/checkpoint now supports:
- /checkpoint or /checkpoint create
- /checkpoint list
- /checkpoint select <id>

Checkpoint selection restores agent state only. It does not restore source bytes. Changed/missing files are marked stale and appear as ledger blockers requiring revalidation.

## Current regression gate

- Current runtime: **118 passed tests + 1 live-only skipped test across 70 test files**.
- Node 22.19.0: **118 passed tests + 1 live-only skipped test across 70 test files**.
- TypeScript typecheck: passed.
- Build: passed.
- Lint: passed.
- CLI launch on Node 22.19.0: passed.
- npm audit: **0 vulnerabilities**.

Remaining external release gates are unchanged: live configured provider evidence, Linux CI execution result, real-model paired coding benchmark, project license selection, and the reference 60-second idle CPU measurement.

Node 22.19.0 continues to emit the upstream ExperimentalWarning for node:sqlite.

## Follow-up review

A fourth review pass hardened immutable session test-trust baselines, payload/version snapshot integrity, transcript-aligned checkpoint restore, transcript-aware recovery, parser consistency, content-derived generations and ledger bounds. See `docs/review-fixes-round4-20260919.md`.

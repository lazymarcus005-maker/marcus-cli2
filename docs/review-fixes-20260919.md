# Code Review Remediation — 2026-09-19

Scope: findings #1–#13 from the post-implementation review of Macus Code.

## Result

All thirteen findings have corresponding production-path changes and regression evidence. The most important architectural correction is that safety/workflow modules are now wired into the actual Pi execution path rather than existing only as isolated helpers.

| # | Finding | Fix | Regression evidence |
| --- | --- | --- | --- |
| 1 | Timeout/cancel could hang after SIGTERM | PolicyExecutor now starts a grace timer immediately after TERM and sends SIGKILL while still awaiting process exit | tests/security-regressions.test.ts, tests/timeout.test.ts |
| 2 | Secret files could enter model context | Central PathPolicy now gates search/read/index/Git and denies known secret/internal paths independent of .gitignore | tests/security-regressions.test.ts |
| 3 | Credential/output redaction incomplete | Provider credential env names are derived from trusted provider config, stripped from subprocess env, and secret values are redacted before DB/log/model-facing output persistence | tests/security-regressions.test.ts |
| 4 | AgentHarness not wired | PiAgentKernel now creates a durable run-scoped AgentHarness and enforces turn/no-progress/time limits before provider dispatch | tests/harness-runtime.test.ts |
| 5 | WorkingSet/selector not wired | Pi context runtime now updates ACTIVE/DISCOVERED/RELATED entries, revalidates source hashes, and selects bounded current fragments before provider dispatch | tests/context-runtime-integration.test.ts, tests/end-to-end-workflow.test.ts |
| 6 | Test evidence not wired | run_test is a first-class agent tool using runTest(), durable evidence, snapshot digest and review freshness | tests/end-to-end-workflow.test.ts, tests/review-freshness.test.ts |
| 7 | File-write TOCTOU | safeWrite re-hashes source immediately before atomic rename and aborts on mismatch | tests/toctou-write.test.ts |
| 8 | Mutation lock missed recovery/checkpoint paths | CLI owns the worktree mutation lock independently of kernel creation; /checkpoint and /resume acquire it before durable mutation/reconciliation | src/cli.ts plus tests/recovery.test.ts lock foundation |
| 9 | Feature defaults/gating inconsistent | Complete-V1 defaults moved to capabilities.ts; optional Git/task tools and CLI surfaces honor feature flags | tests/capabilities.test.ts |
| 10 | /diff and /review lacked actual diff/freshness | /diff emits bounded git state + diff; review includes actual diff, attribution, current snapshot comparison and stale evidence risk | tests/review-freshness.test.ts |
| 11 | Limits under-validated / model timeout override | Config validates run/execution/retrieval/log limits and PolicyExecutor clamps requested timeout to user ceiling | tests/config-limits.test.ts, tests/timeout-clamp.test.ts |
| 12 | Search cursor ignored source generation | Cursor binds query plus repository source generation and rejects after source change | tests/cursor-generation.test.ts |
| 13 | Graph stale edges | File-level edge replacement, index reconciliation, file invalidation and dangling-target pruning added | tests/graph-invalidation.test.ts |

## Additional Pi compatibility correction

Pi 0.85.1 catches exceptions thrown by extension handlers for before_provider_request and reports them as extension errors rather than propagating them as a hard dispatch failure. Therefore Macus does not rely on throwing from that hook.

The Macus provider gate now:
1. validates harness limits and request budget;
2. stores the blocking reason;
3. calls ExtensionContext.abort() before network dispatch;
4. propagates the stored reason from PiAgentKernel.prompt().

Evidence:
- tests/harness-runtime.test.ts proves a provider turn beyond max_model_turns is not sent over HTTP.
- tests/budget-gate-integration.test.ts proves an oversized effective request is aborted with zero HTTP requests.

## End-to-end orchestration evidence

tests/end-to-end-workflow.test.ts drives the real PiAgentKernel through a deterministic local OpenAI-compatible endpoint:

search_code -> task_create -> task in_progress -> read_range -> write_file -> run_test -> task completed -> review -> final response -> dispose -> reopen same session -> resume.

It verifies:
- source was changed through the hash-guarded policy path;
- durable task state completes;
- structured JUnit evidence is persisted as passed;
- review evidence is fresh;
- Pi transcript history survives kernel recreation.

## Current regression status

- Current tunnel runtime: 118 tests passed; 1 live-only test skipped across 70 test files.
- Node 22.19.0 target runtime: 118 tests passed; 1 live-only test skipped across 70 test files.
- TypeScript typecheck: passed.
- Build: passed.

These local results do not replace the remaining external release gates: live configured provider evidence, Linux CI result, real-model paired coding benchmark, project license choice and the reference 60-second idle CPU measurement.

## Follow-up review

A second review pass found and remediated additional runtime/durability edge cases. See `docs/review-fixes-round2-20260919.md`.

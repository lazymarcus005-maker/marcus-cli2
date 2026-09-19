# Code Review Remediation Round 2 — 2026-09-19

Scope: follow-up findings after the first 13-item remediation pass.

## Result

All ten follow-up findings have production-path changes and regression evidence.

| # | Finding | Remediation | Evidence |
| --- | --- | --- | --- |
| 1 | max_duration_seconds was only checked at turn/stage boundaries | PiAgentKernel now starts a run-scoped wall-clock deadline and aborts the active Pi session when it expires; the durable run is finalized as blocked | tests/run-duration.test.ts |
| 2 | Git diff/show could expose tracked .macus/internal or secret paths | PathPolicy now emits explicit Git exclude pathspecs for internal/build/secret patterns; gitDiff and gitShow apply them | tests/git-policy.test.ts |
| 3 | Multi-suite JUnit could be reported green after only parsing the first suite | JUnit parsing now uses aggregate testsuites counters when present or sums every testsuite tag | tests/report-parsers.test.ts |
| 4 | Truncated repo-map discovery could delete valid index entries | SymbolIndex.discover() now returns {files,truncated}; reconciliation is skipped for partial discovery | tests/repo-map-truncation.test.ts |
| 5 | Ledger persistence failure could leave a run permanently running | PiAgentKernel.prompt() computes final status, attempts ledger persistence, and finalizes the run even when ledger persistence fails | tests/run-finalization.test.ts |
| 6 | Durable context ledger was not hydrated on resume | Kernel creation restores goal and fresh working files after PathPolicy + hash verification; stale/missing/denied entries are not trusted | tests/resume-ledger.test.ts |
| 7 | Pre-aborted cancellation could still launch shell/search work | PolicyExecutor and searchCode check already-aborted signals before launch and close the small registration race after listener setup | tests/preaborted-cancellation.test.ts |
| 8 | search_symbol(path=...) returned same-name symbols from unrelated files | SymbolIndex.search() accepts a path scope and the tool always applies the requested canonical path | tests/symbol-scope.test.ts |
| 9 | no-progress detection covered run_test but not repeated failing shell/tool attempts | Runtime tool_result classification now fingerprints stable run_command failures and resets no-progress only on material progress | tests/no-progress-runtime.test.ts |
| 10 | repo-map token budget was treated as a character limit | repoMap() now uses the same conservative request estimator instead of raw character count | tests/repo-map-truncation.test.ts |

## Runtime behavior changes

### Hard run deadline

The run-level deadline is independent of provider responsiveness. A provider that accepts a request and never responds is aborted when max_duration_seconds is reached. This complements, rather than replaces:
- max_model_turns;
- max_no_progress_attempts;
- per-command/test timeouts.

### Durable run finalization

Run finalization no longer depends on ledger persistence succeeding. If the model work succeeds but the ledger write fails, the run is finalized as failed and the ledger error is propagated. This prevents stale running rows after partial durability failures.

### Resume hydration

Ledger working files are treated as hints, not trusted source:
1. resolve through PathPolicy;
2. re-read current hash;
3. restore as RELATED/WARM only when the hash matches;
4. mark or discard stale/invalid paths rather than injecting old content.

### Truncated repository discovery

A bounded discovery result is now explicitly marked truncated. Partial discovery may refresh discovered files, but it is never authoritative enough to delete index/graph state for files outside the window.

## Current regression gate

- Current runtime: **118 passed tests + 1 live-only skipped test across 70 test files**.
- Node 22.19.0: **118 passed tests + 1 live-only skipped test across 70 test files**.
- TypeScript typecheck: passed.
- Build: passed.
- npm audit: **0 vulnerabilities**.

Remaining external release gates are unchanged: live configured provider evidence, Linux CI execution result, real-model paired coding benchmark, project license selection, and the reference 60-second idle CPU measurement.

## Follow-up review

A third review pass hardened trusted test evidence, context freshness, journal correlation, task-linked evidence, staged Git review and checkpoint restore. See `docs/review-fixes-round3-20260919.md`.

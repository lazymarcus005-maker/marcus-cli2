# Macus Code — Final Implementation Report

Date: 2026-09-19
Specification: v1.1
Implementation tickets: T-001 through T-024

## Outcome

All 24 ticket scopes now have corresponding implementation in the workspace. The result is a functional implementation preview with CLI, Pi adapter, trusted configuration, policy/state/recovery foundations, bounded source intelligence, request-context control, workflow/evidence, durable ledger/checkpoints, optional relationship graph, benchmark tooling, tests, packaging and documentation.

This report intentionally does **not** call the build production-ready V1 because some release evidence requires a live provider, Linux runner, user-selected license and real-model benchmark.

## Major implementation areas

- Pi 0.85.1 adapter using public SDK and extension event surfaces.
- Hard provider-request gate through before_provider_request + ExtensionContext.abort(); run-limit and context-budget violations are blocked before HTTP dispatch.
- Effective context hook preserving tool protocol groups while suppressing duplicate/superseded source.
- Trusted global/project configuration with endpoint/credential authority separation.
- Explicit session authorization for workspace edits and shell execution.
- SQLite durable sessions/runs/tasks/journal/evidence/checkpoints.
- Transactional initial schema migration with rollback/future-schema protection.
- OS-backed single-mutator worktree lock.
- Atomic hash-guarded source writes and crash reconciliation.
- Bounded process output/log retention with explicit expired-log behavior.
- ripgrep bounded search and cursor behavior.
- Tree-sitter TS/TSX, JS/JSX and C# syntax intelligence.
- Rebuildable source index and bounded repository map.
- Runtime-wired working set (ACTIVE/RELATED/DISCOVERED/STALE), tiered selector, manifests and context inspection.
- Runtime-wired task engine, bounded run/no-progress loop, run_test tool and JUnit/TRX durable evidence.
- Git state/diff/log/show/blame and review evidence.
- Context ledger and state-only checkpoints with orphan reconciliation.
- Coordinated Pi manual/automatic compaction behavior including cancellation.
- Conservative optional relationship graph and impact tools.
- Interactive macus CLI with model/session/context/task/diff/checkpoint/review controls.
- Reference retrieval/index benchmark and deterministic paired Pi/Macus harness.
- Optional Jev/System One harness decision engine with global-only enablement, shadow-only failure/progress/review decisions, durable metrics and soft-fail transport.
- package metadata, CI matrix, README/config example and third-party notices.

## Validation performed

Latest local validation:
- npm run typecheck — passed.
- npm run lint — passed.
- npm run build — passed.
- npm test — **118 passed; 1 live-only skipped across 70 test files** on the current runtime and Node 22.19.0.
- npm audit — 0 known vulnerabilities.
- Node 22.19.0 CLI — macus --help passed.
- clean package tarball install — passed.
- 10,000-file / ~102.4 MB Node 22 retrieval/index benchmark — completed.
- temporary Git repository fixture — passed.
- deterministic 3-pair Pi/Macus mock benchmark — completed.

Key Node 22 reference metrics:
- cold index: 3.81 s, ~2,624 files/s.
- warm bounded text search p95: 297.25 ms / 100 runs.
- verified cached source read p95: 0.197 ms / 100 runs.
- single-file 10 KiB refresh p95: 0.570 ms / 100 runs.
- observed peak RSS: ~96.4 MiB.

## Remaining release blockers

1. Live external provider compatibility is pending because this tunnel environment has no configured Macus model endpoint/key.
2. Linux CI execution result is not available from this session.
3. Full real-model coding-task Pi-vs-Macus correctness/token/latency benchmark is pending.
4. Macus Code project publication license requires the user's choice.
5. The specification's 60-second idle CPU reference observation has not been recorded.
6. Node 22.19.0 still labels node:sqlite experimental upstream.
7. Jev live OpenRouter/TypeSafe provider validation is available but was not executed in the normal regression run; shadow calibration data is not yet sufficient for advisory promotion.

## Source-control note

The implementation workspace itself is not a Git repository. No commit, push, merge, reset or publication action was performed.

## Evidence locations

- docs/implementation-map.md
- docs/pi-compatibility.md
- docs/phase-1-evidence.md through docs/phase-7-evidence.md
- docs/recovery-matrix.md
- docs/benchmark-report.md
- docs/ticket-status.md
- tests/

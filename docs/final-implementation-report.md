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
- Typed tool-result normalization shared by harness decisions, progress tracking and Jev coordination.
- Provider runtime boundary for model lookup, protocol normalization, registration and model switching.
- Durable continuity boundary for checkpoint capture, resume reconciliation and restore sequencing.
- Central verification assessment for evidence freshness, latest-result precedence, task linkage and CLI completion status.
- Trusted `run_command` execution records verification evidence from the completed command and links it to the active task.
- CLI application boundary owns session, kernel, authorization, lock and continuity lifecycle; command registry consumes a narrow actions interface.
- `CONTEXT.md` records the repository's domain vocabulary for verification, tool outcomes, provider runtime, continuity, CLI application and task evidence.
- package metadata, CI matrix, README/config example and third-party notices.

## Validation performed

Latest local validation:
- npm run typecheck — passed on Node 22.19.0 after the architecture changes.
- npm run lint — passed on Node 22.19.0 after the architecture changes.
- npm run build — passed on Node 22.19.0 after the architecture changes.
- Node 22.19.0 / npm 11.6.2 clean install — passed (228 packages; audit found 0 vulnerabilities).
- npm test — **136 passed; 1 live-only skipped across 76 test files** on Node 22.19.0, including provider-runtime, durable-continuity, verification-assessment, trusted-command evidence, tool-result coordination, CLI application and end-to-end CLI coverage.
- Current package artifact: `npm pack` produced a 163-entry, 616,527-byte unpacked tarball; installing it under a separate prefix added 179 packages. The installed executable includes a Node shebang and passed `--help` and `--json` status startup.
- Installed-package E2E against a local OpenAI-compatible endpoint: two provider requests, `run_command` launched a real fixture `npm test`, trusted passing evidence was recorded, and the installed CLI exited 0.
- Live TypeSafe direct-provider test passed with a minimal connectivity state. `jev-latest` resolved to `jev-1.13.0`, returned a valid Noul answer, and reported 304 input / 20 output tokens in about 0.8 s.
- Installed-package Jev integration E2E passed: a local main-model fixture produced a command failure, TypeSafe answered the shadow failure-triage request, and SQLite recorded `provider=typesafe`, `model=jev-1.13.0`, `mode=shadow`, `status=success` in 827 ms.
- An initial TypeSafe direct request using the OpenRouter model ID was rejected as unknown. Direct transport now defaults to `jev-latest` and `TYPESAFE_API_KEY`, with regression coverage. OpenRouter live validation was not rerun because `OPENROUTER_API_KEY` is not configured.
- Live OpenCode Go / `deepseek-v4-flash-vision-exp` coding run — provider returned a response, made the requested fixture edit, and the fixture's `npm test` passed. Macus still marked verification evidence `unknown` and exited 3, so the end-to-end result is not a full pass.
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

1. OpenCode Go live validation after the latest architecture changes remains pending. An earlier model call and fixture edit worked, but Macus verification evidence was `unknown` (exit 3). TypeSafe direct Jev is now validated live; OpenRouter Jev was not rerun.
2. Linux CI execution result is not available from this session.
3. Full real-model coding-task Pi-vs-Macus correctness/token/latency benchmark is pending.
4. Macus Code project publication license requires the user's choice.
5. The specification's 60-second idle CPU reference observation has not been recorded.
6. Node 22.19.0 still labels node:sqlite experimental upstream.
7. Jev shadow calibration data is not yet sufficient for advisory promotion.

## Source-control note

The implementation workspace contains uncommitted changes. No commit, push, merge, reset or publication action was performed.

## Evidence locations

- docs/implementation-map.md
- docs/pi-compatibility.md
- docs/phase-1-evidence.md through docs/phase-7-evidence.md
- docs/recovery-matrix.md
- docs/benchmark-report.md
- docs/ticket-status.md
- tests/

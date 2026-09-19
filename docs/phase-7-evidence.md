# Phase 7 Evidence — Release Hardening

Status: **implementation hardening complete locally; production V1 release gate not fully closed because external evidence remains**.

## Passed local evidence

- macOS arm64 on Apple M4 Pro / 48 GiB.
- Node 22.19.0 target-runtime CLI launch.
- npm typecheck, lint and build pass on Node 22.19.0 after the architecture improvements.
- Vitest: 136 passed tests + 1 live-only skipped test across 76 files pass on Node 22.19.0.
- Current clean dependency install: 228 packages installed; `npm audit --audit-level=low` found 0 vulnerabilities.
- Current tarball installation passed `macus --help` and `macus --json` status startup from a separate install prefix; its executable has the Node shebang.
- Installed tarball E2E against a local OpenAI-compatible endpoint passed end to end: provider tool call, fixture `npm test`, fresh passing trusted evidence, exit 0.
- TypeSafe direct live test passed with `jev-latest`, resolved as `jev-1.13.0`, returning a schema-valid Noul response.
- Installed-package CLI E2E with live TypeSafe Jev recorded a successful shadow failure-triage event (`typesafe`, `jev-1.13.0`, 827 ms) while the primary model used a local fixture server.
- OpenRouter live test remains unrun because `OPENROUTER_API_KEY` is unset.
- Live OpenCode Go `deepseek-v4-flash-vision-exp` run returned a response and edited a disposable Git fixture; its `npm test` passed. Macus recorded verification evidence as `unknown` and exited 3, so the live coding E2E is only partially passing.
- CI workflow defines Ubuntu + macOS Node 22.19.0 matrix.
- Pi nested tool-turn/request interception integration passes against deterministic mock endpoint.
- Provider runtime, durable continuity, verification assessment, typed tool-result coordination and CLI application boundary tests pass.
- CLI end-to-end tests pass for normal-mode verification exit codes, unverified workspace edits returning exit 3, and a trusted `run_command` test recording fresh passing evidence.
- effective context stale-source replacement integration passes.
- durable session resume integration passes.
- compaction cancellation integration passes.
- transactional migration rollback and future-schema rejection pass.
- checkpoint orphan/missing-file reconciliation and expired-log behavior pass.
- temporary Git fixture validates branch/state/diff/log/show/blame behavior.
- reference retrieval/index benchmark measured at 10,000 files / ~102.4 MB on Node 22.19.0.
- warm search p95 297.25 ms over 100 queries.
- verified cached read p95 0.197 ms over 100 runs.
- single-file refresh p95 0.570 ms over 100 runs.
- observed peak RSS ~96.4 MiB.
- deterministic 3-pair Pi/Macus mock harness rerun successfully.

## External or policy-dependent release blockers

1. **Live external provider compatibility:** TypeSafe direct Jev passed a live provider test. The OpenCode Go provider still needs a fresh live test after the latest changes; the earlier call completed a coding response but Macus reported `unknown` test evidence (exit 3). OpenRouter Jev remains untested in this run.
2. **Linux execution result:** CI configuration exists, but no Linux runner result is observable from this session.
3. **Full real-model paired coding benchmark:** no comparative correctness/token/latency benchmark has been recorded.
4. **Project license:** Macus Code's own publication license has not been selected by the user. Third-party notices are present.
5. **60-second idle CPU release measurement:** benchmark support exists, but the specific 60-second reference observation has not been recorded.

## Runtime limitation

Node 22.19.0 emits the upstream warning that node:sqlite is experimental. Tests pass, but this remains a runtime caveat to review before publication.

Because external gates above remain unresolved, the repository must not yet be labelled production-ready V1.

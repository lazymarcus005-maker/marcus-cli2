# Phase 7 Evidence — Release Hardening

Status: **implementation hardening complete locally; production V1 release gate not fully closed because external evidence remains**.

## Passed local evidence

- macOS arm64 on Apple M4 Pro / 48 GiB.
- Node 22.19.0 target-runtime CLI launch.
- npm typecheck/lint/build pass.
- Vitest: 118 passed tests + 1 live-only skipped test across 70 files pass on both the current runtime and Node 22.19.0.
- npm audit: 0 known vulnerabilities.
- npm package dry-run and clean tarball installation pass.
- clean-installed package launches macus --help.
- CI workflow defines Ubuntu + macOS Node 22.19.0 matrix.
- Pi nested tool-turn/request interception integration passes against deterministic mock endpoint.
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

1. **Live external provider compatibility:** the tunnel environment does not expose a configured MACUS model endpoint/key, so real-provider compatibility is not claimed.
2. **Linux execution result:** CI configuration exists, but no Linux runner result is observable from this session.
3. **Full real-model paired coding benchmark:** cannot be run without a live configured endpoint; no token/quality improvement claim is made.
4. **Project license:** Macus Code's own publication license has not been selected by the user. Third-party notices are present.
5. **60-second idle CPU release measurement:** benchmark support exists, but the specific 60-second reference observation has not been recorded.

## Runtime limitation

Node 22.19.0 emits the upstream warning that node:sqlite is experimental. Tests pass, but this remains a runtime caveat to review before publication.

Because external gates above remain unresolved, the repository must not yet be labelled production-ready V1.

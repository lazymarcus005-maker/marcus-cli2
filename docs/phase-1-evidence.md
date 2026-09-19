# Phase 1 Evidence — Agent Foundation & Safety

Implementation status: **implemented; release gate partially blocked by unavailable external live provider credentials**.

## Implemented

- Node target pinned to 22.19.0 and npm lockfile.
- Pi pinned to @earendil-works/pi-coding-agent 0.85.1.
- Public Pi SDK mapping documented in docs/pi-compatibility.md.
- Branded `macus` CLI and session commands.
- Trusted config/model binding and repository instruction resolver.
- Central PolicyExecutor with explicit session authorization for edits/shell.
- Bounded output/log streaming, journal and worktree lock.
- SQLite durable state/session/task/journal schema.
- Request budget guard on every `before_provider_request`; hard failures call ExtensionContext.abort() because Pi 0.85.1 catches extension-handler exceptions.
- Context hook preserves tool protocol while suppressing duplicate/superseded source content.
- Manual Pi compaction and optional checkpoint coordination.
- Benchmark harness.

## Validation

Commands:
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm test`
- target-runtime test through Node 22.19.0
- `npm audit`

Evidence:
- Pi nested tool-turn integration: tests/pi-adapter.test.ts.
- source freshness across read → write → next provider request: tests/context-runtime-integration.test.ts.
- session transcript continuation: tests/session-resume-integration.test.ts.
- policy/hash/timeout/recovery tests in tests/.

## Gate limitation

No `MACUS_MODEL_BASE_URL` or `MACUS_MODEL_API_KEY` is present in the actual tunnel process environment. Therefore live compatibility with the user's real provider is **not marked passed**. The deterministic local OpenAI-compatible mock proves protocol behavior only.

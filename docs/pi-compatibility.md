# Pi Compatibility — 0.85.1

Pinned package: `@earendil-works/pi-coding-agent@0.85.1`
Required Node engine from the package: `>=22.19.0`
Macus target: Node 22.19.x.

Verified from the installed public type declarations and the pinned implementation:

| Macus capability | Pi public surface |
| --- | --- |
| Session creation | `createAgentSession()` |
| Session replacement/runtime | Agent session/session-manager lifecycle APIs |
| Streaming | `AgentSession.subscribe()` and message/tool lifecycle events |
| Initial prompt | `AgentSession.prompt()` |
| Steering | `AgentSession.steer()` |
| Follow-up queue | `AgentSession.followUp()` |
| Cancellation | `AgentSession.abort()`, compaction abort path |
| Model switch | `AgentSession.setModel()` |
| Manual compaction | `AgentSession.compact()` |
| Auto-compaction control | `setAutoCompactionEnabled()` |
| Provider request interception | extension event `before_provider_request` |
| Context transformation | extension event `context` |
| Pre-compaction coordination | extension event `session_before_compact` |
| Tool policy hook | extension `tool_call` / `tool_result` |
| Custom tools | `customTools` / `defineTool()` |
| Resource control | `DefaultResourceLoader`, including `noContextFiles` and inline extensions |
| Provider registration | `ModelRuntime.registerProvider()` and `setRuntimeApiKey()` |

Macus uses `noContextFiles: true` and resolves repository instructions itself to avoid double-loading repository guidance. Built-in Pi bash/edit/write are suppressed; Macus mutation/command tools route through PolicyExecutor.

## Critical before_provider_request behavior

Pi 0.85.1's extension runner catches exceptions raised by `before_provider_request` handlers and reports them as extension errors. A thrown exception alone is therefore **not** a reliable hard gate against provider dispatch.

Macus uses the public ExtensionContext cancellation surface instead:
- validate run limits and effective request budget;
- on failure, save a blocking reason and call `ctx.abort()`;
- PiAgentKernel propagates that reason to the caller after Pi settles.

Deterministic integration tests verify that both a run-limit violation and an oversized context request are blocked before an HTTP request reaches the mock provider.

## Compaction behavior

Macus handles `session_before_compact` to commit durable ledger/checkpoint state before manual or automatic Pi compaction. A checkpoint failure returns `{ cancel: true }`, so compaction does not proceed with falsely durable state.

## Compatibility evidence

- Nested tool turns and provider-request interception: tests/pi-adapter.test.ts.
- Provider hard-gate on turn limit: tests/harness-runtime.test.ts.
- Provider hard-gate on context overflow: tests/budget-gate-integration.test.ts.
- Session persistence/resume: tests/session-resume-integration.test.ts.
- Compaction cancellation + durable pre-compaction state: tests/compaction-cancel.test.ts.

A live external provider test remains a release gate because this workspace session does not expose a configured trusted production/provider endpoint and credential.

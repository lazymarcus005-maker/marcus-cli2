# Phase 8 Evidence — Runtime Simplification, Scalability, and Operator UX

Date: 2026-09-19  
Source plan: `improvement.md`  
Status: **Implemented**

## Outcome

All Phase 8 improvement items IMP-001 through IMP-010 are implemented with regression coverage.

| Improvement | Status | Primary implementation | Evidence |
| --- | --- | --- | --- |
| IMP-001 Lazy session creation | Complete | `src/runtime/session-coordinator.ts`, CLI lifecycle | `tests/lazy-session.test.ts` |
| IMP-002 Read-only vs mutation lock | Complete | `src/runtime/lock-coordinator.ts`, `PolicyExecutor` lazy escalation | `tests/mutation-lock-escalation.test.ts` |
| IMP-003 Incremental workspace snapshot | Complete | `src/testing/snapshot-store.ts` | `tests/workspace-snapshot-cache.test.ts` + benchmark below |
| IMP-004 Split PiAgentKernel | Complete | `ContextCoordinator`, `ToolResultCoordinator`, `RunController` | existing context/run/compaction integration suites |
| IMP-005 Storage repository APIs | Complete | domain methods on `StateStore`; schema v2 | `tests/storage-boundary.test.ts`, `tests/migration.test.ts` |
| IMP-006 CLI command registry | Complete | `src/cli/registry.ts`, `src/cli/commands.ts` | `tests/cli-registry.test.ts` |
| IMP-007 Trusted-test operator UX | Complete | `/trust status|diff|refresh`, trust history/digests | `tests/trust-refresh.test.ts` |
| IMP-008 Human terminal dashboard | Complete | `src/cli/render.ts` | `tests/cli-json-mode.test.ts` |
| IMP-009 Non-interactive JSON mode | Complete | `--json`, `--resume`, `--authorize`, exit-code contract | `tests/cli-json-mode.test.ts` |
| IMP-010 Local runtime metrics | Complete | `runtime_metrics`, `/metrics` | `tests/runtime-metrics.test.ts` |

## Architecture result

`PiAgentKernel` decreased from approximately **562 lines to 308 lines**.

Responsibilities extracted into:

```text
src/context/coordinator.ts
src/agent/tool-result-coordinator.ts
src/runtime/run-controller.ts
src/runtime/session-coordinator.ts
src/runtime/lock-coordinator.ts
src/cli/registry.ts
src/cli/commands.ts
src/cli/render.ts
```

Production code outside `src/storage/state.ts` no longer calls `store.db.prepare()` or `store.db.exec()`. A static regression test enforces that boundary.

## Session and lock behavior

Passive operations do not create a durable session:

```text
macus --help
macus --json
```

A session is created when a normal prompt first needs one, or explicitly through `/clear`.

Resume is available before creating a new session:

```bash
macus --resume <sessionId>
macus --resume <sessionId> --json "continue"
```

Read-only kernel operation does not acquire the exclusive worktree mutation lock. The lock is acquired immediately before:

- workspace write;
- shell/test execution;
- checkpoint restore;
- recovery mutation.

Authorization and mutation ownership remain independent safety gates.

## Incremental workspace snapshot

Workspace evidence remains content-derived, but unchanged content hashes are reused within the process.

Cache identity uses:

```text
path
size
mtimeNs
ctimeNs
inode
content hash
```

If file identity changes, the file is rehashed. A same-size edit with restored mtime is still detected.

Macus-owned writes update the cache with the already-known after-hash, avoiding a second file-content read.

The cache is currently **process-local**. A new process starts cold. Warm verification still traverses/stat-checks repository files, so metadata work scales with file count, while content bytes scale primarily with changed files.

### Synthetic benchmark

Command:

```bash
npm run bench:snapshot -- --files <count> --bytes <bytes-per-file>
```

Results on this macOS development environment:

| Dataset | Cold | Warm | One-file change |
| --- | ---: | ---: | ---: |
| 100 files / ~1.0 MB | 21.8 ms / ~1.02 MB read | 2.49 ms / 0 bytes | 2.45 ms / ~10.2 KB |
| 2,000 files / ~20.5 MB | 166.5 ms / ~20.43 MB read | 34.6 ms / 0 bytes | 32.6 ms / ~10.2 KB |
| 10,000 files / ~1.024 GB | 1,284.5 ms / ~1.024 GB read | 156.1 ms / 0 bytes | 152.0 ms / ~102 KB |

For the 10,000-file case:

- warm content-byte reduction vs cold: **100%**;
- one-file-change content-byte reduction vs cold: **~99.99%**;
- warm still pays directory/stat traversal cost.

These are local synthetic measurements, not universal performance guarantees.

## Trusted verification UX

New commands:

```text
/trust status
/trust diff
/trust refresh
```

`/trust refresh` is user-only and requires interactive confirmation. It is not registered as an agent tool and is rejected in non-interactive JSON mode.

Each test evidence record stores the digest of the trust snapshot under which it ran, so refreshing the current baseline does not rewrite authority for older evidence.

Schema v2 adds durable `session_trust_history`.

## Human and automation interfaces

Human-readable defaults:

```text
/status
/tasks
/context
/review
/metrics
/trust status
/trust diff
```

Structured output remains available with `--json` where applicable.

One-shot automation:

```bash
macus --json "review this repository"
macus --resume <sessionId> --json "continue"
```

Prompt-run JSON envelope includes:

```text
sessionId
runId
status
result
tasks
evidence
remainingRisk
error
```

Current exit-code contract:

```text
0  completed/no failed verification evidence
1  runtime/internal error
2  blocked by authorization/policy
3  completed run with non-passing/stale latest verification evidence
4  recovery/correlation/checkpoint identity conflict
5  context/model/run-limit failure
```

No-evidence read-only prompts return 0.

## Local metrics

Schema v2 adds `runtime_metrics`.

Current local measurements include:

```text
cli.startup_ms
session.create_ms
kernel.create_ms
provider.ttft_ms
provider.prepare_ms
provider.request_input_tokens
context.prepare_ms
context.selected_tokens
search.latency_ms
repo_map.latency_ms
snapshot.digest_ms
snapshot.bytes_read
snapshot.hash_reused_files
snapshot.hash_rehashed_files
test.duration_ms
review.duration_ms
checkpoint.create_ms
checkpoint.restore_ms
recovery.duration_ms
sqlite.operation_ms
```

Inspect:

```text
/metrics
/metrics --json
```

No external telemetry backend was introduced.

## State migration

State schema is now version 2.

Upgrade behavior:

- fresh stores start at v2;
- v1 stores upgrade transactionally to v2;
- migration is idempotent;
- future schemas above v2 fail closed.

New v2 tables:

```text
session_trust_history
runtime_metrics
```

Existing sessions, transcript files, ledger revisions, tasks, evidence, checkpoints, execution journal, trust snapshots, and Jev decision events remain preserved.

## Current validation gate

Current runtime:

```text
118 tests passed
1 live-only Jev test skipped
69 test files passed
1 live-only test file skipped
70 test files total
typecheck: PASS
build: PASS
lint: PASS
```

Node 22.19.0:

```text
118 tests passed
1 live-only Jev test skipped
69 test files passed
1 live-only test file skipped
70 test files total
```

Additional gates:

- `npm audit --audit-level=low`: **0 vulnerabilities**;
- Node 22.19.0 CLI `--help`: PASS;
- production raw-SQL boundary: PASS;
- Phase 8 snapshot benchmark: PASS.

The skipped Jev live test is intentional unless `MACUS_JEV_LIVE_TEST=1` and a live credential are supplied.

## Remaining external release gates

Phase 8 itself is complete. The broader project release gates remain:

1. live configured primary-provider evidence;
2. Linux CI execution result;
3. real-model paired Pi-vs-Macus coding benchmark;
4. project license selection;
5. reference 60-second idle CPU measurement;
6. Jev live-provider validation/calibration before any advisory promotion.

Node 22.19.0 continues to emit the upstream ExperimentalWarning for `node:sqlite`.

# Benchmark Report

Status: **reference retrieval/index benchmark complete; deterministic paired harness complete; live-model coding benchmark pending**.

Reference environment measured in this workspace:
- Apple M4 Pro
- 48 GiB unified memory
- macOS arm64
- Node 22.19.0
- Pi package pinned at 0.85.1

## Reference retrieval/index fixture

Measured fixture:
- 10,000 TypeScript files
- 10,240 bytes per file
- approximately 102,400,000 bytes total
- 100 warm text-search queries
- 100 verified cached symbol reads
- 100 single-file refreshes

Latest Node 22.19.0 results:

| Metric | Result | Initial target |
| --- | ---: | ---: |
| Cold index | 3,810.95 ms | report only |
| Cold indexing throughput | 2,624 files/s | report only |
| Warm bounded text search p95 | 297.25 ms | <= 500 ms |
| Verified cached symbol read p95 | 0.197 ms | <= 200 ms |
| Single-file refresh p95, 10 KiB file | 0.570 ms | <= 1,000 ms |
| Peak CLI/index RSS observed | 101,105,664 bytes (~96.4 MiB) | <= 512 MiB |

The verified cached-read measurement performs a source-hash freshness check through readRange, not only a SQLite lookup.

Idle CPU measurement support is implemented through MACUS_BENCH_IDLE_SECONDS. The release rule requires a 60-second observation; that specific long-duration measurement has not been recorded in this session.

## CLI startup

A prior Node 22.19.0 command-path measurement of 30 executions of node dist/cli.js --help recorded:
- median: 366.68 ms
- p95: 411.20 ms
- min: 342.25 ms
- max: 412.41 ms

This is a CLI command-path startup measurement, not proof of a fully model-ready interactive prompt with live provider initialization.

## Deterministic paired Pi vs Macus harness

Three paired repetitions were rerun against the same local OpenAI-compatible mock endpoint, alternating order by pair.

Latest wall times in milliseconds:

| Pair | Pi | Macus |
| --- | ---: | ---: |
| 1 | 29.120 | 5.551 |
| 2 | 5.331 | 3.477 |
| 3 | 5.386 | 3.075 |

Arithmetic averages:
- Pi: 13.279 ms
- Macus: 4.034 ms

These numbers are **not a product performance claim**. The endpoint has effectively zero model latency, the task is only a tool-less reply-ok microbenchmark, and there is no coding-task quality or token oracle. The result proves the paired harness, repeated conditions and alternating-order machinery only.

## Correctness/regression evidence

Latest regression:
- 118 tests passed; 1 live-only test skipped across 70 test files on the tunnel runtime.
- Node 22.19.0 CLI launch passed.
- npm audit reports 0 vulnerabilities.
- clean tarball installation launches macus --help.
- mock OpenAI-compatible Pi integration proves nested tool turns and actual request interception.
- context integration proves superseded source is removed from later provider payloads.
- resume integration proves Pi transcript continuation across durable session reopen.
- recovery tests cover unknown side effects, compaction cancellation, migration rollback/future schema, checkpoint reconciliation and expired logs.
- temporary Git fixture validates git state, diff, log, show, blame and stable worktree identity across branch changes.

## Pending live/release measurements

Not claimed:
- real-model discovery/edit/test coding-task comparison;
- real-model task correctness and total request/response tokens;
- provider cached/uncached token measurements;
- first-useful-edit time on real coding tasks;
- 60-second idle CPU release measurement;
- Linux runtime measurement.

The current tunnel environment does not expose a configured live Macus model endpoint/key, so live-model quality/token claims remain pending.

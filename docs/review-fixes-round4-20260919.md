# Code Review Remediation Round 4 — 2026-09-19

Scope: follow-up findings after the 72/72-test remediation state.

## Result

All findings from the fourth review pass now have production-path changes and deterministic regression evidence.

| # | Finding | Remediation | Evidence |
| --- | --- | --- | --- |
| 1 | Agent could mutate package.json/project files and make a fake test command become trusted | Trusted test/build commands are snapshotted at durable session creation together with trust-source content hashes. A command remains trusted only while its baseline source files are unchanged. | tests/test-evidence-trust.test.ts |
| 2 | Search/symbol/repo-map payload and version token could come from different source snapshots | search_code rechecks each returned line against the same file snapshot used for its content hash; parse/read hashes derive from the payload bytes; SymbolIndex stores parsed content hash; repo_map carries per-file indexed hashes. | tests/source-snapshot-race.test.ts, tests/context-search-freshness.test.ts |
| 3 | Checkpoint restore could split task/ledger state from the Pi transcript and partially mutate task state | Checkpoint payloads carry transcriptRef; CLI prevalidates the selected transcript branch; PiAgentKernel navigates via AgentSession.navigateTree(); task + ledger restore occurs in one SQLite transaction and replaces checkpoint task state exactly. | tests/checkpoint-transcript.test.ts, tests/checkpoint-restore.test.ts |
| 4 | run_id/tool_call_id were stored but ignored by recovery | Recovery consumes the selected Pi branch, validates run ownership and tool-call presence, and finalizes shell/test executions from matching Pi tool results when possible. | tests/recovery-transcript.test.ts |
| 5 | JUnit aggregate counters could hide a failing child suite; inconsistent TRX counters were accepted | Structured parsers fail closed when root/child counters disagree or totals are internally inconsistent. | tests/report-parsers.test.ts |
| 6 | sourceGeneration used only path + size + mtime | Repository/search generation now hashes actual file content, so same-size changes with restored mtimes invalidate cursors. | tests/cursor-generation.test.ts |
| 7 | Checkpoint payload/schema validation was weak and corrupted/future records could be treated as committed | Checkpoints now validate schema version, task state, decision/file shapes, active-task cardinality and unknown execution identities. Invalid committed records are marked incomplete. | tests/checkpoint-validation.test.ts |
| 8 | Durable ledger decisions and free text were unbounded | Ledger normalization bounds retained decisions, decision/provenance text, working files, blockers, goal and next action; decision_record tool enforces input limits. | tests/ledger-bounds.test.ts |
| 9 | Historical source freshness verification repeated hashes for the same file within one provider request | Context runtime memoizes current file hashes per provider context pass. repo_map no longer performs a full repository generation walk on every provider turn; only files represented in the map are verified. | existing context integration + source snapshot tests |

## Trusted test baseline

At session creation Macus records:
- trusted command strings discovered from project configuration;
- the trust-source file(s) for each command;
- a content hash for every trust source.

run_test trusts a command only if:
1. it existed in the session baseline;
2. every baseline trust-source file still has the same content hash;
3. the structured report path remains inside the workspace and does not escape through symlinks;
4. the report is fresh for the current run and within parser size bounds;
5. repository identity, HEAD and source snapshot remain stable.

Changing package.json, a solution/project file or another trust source therefore invalidates the associated command until a new user-created session establishes a new baseline.

## Source snapshot integrity

Source-bearing payloads now bind content and version from the same snapshot:
- read_range hashes the exact source string used to create the returned range;
- parseSymbols hashes the exact parsed source string;
- SymbolIndex persists that parsed hash;
- search_code rereads the matched file once, verifies that the rg line still exists at the same line, then attaches the hash of that exact snapshot;
- repo_map exposes hashes from the same indexed snapshot used to build the map.

If a source changes between discovery and verification, stale search matches are dropped with source_changed_during_search rather than being paired with a newer hash.

## Checkpoint restore and Pi transcript

/checkpoint select now:
1. loads and validates the checkpoint;
2. verifies transcriptRef exists on the durable Pi session tree;
3. restores tasks + ledger atomically without restoring source bytes;
4. reconciles unknown executions against the selected transcript branch;
5. stores the selected branch as pending runtime state;
6. AgentSession.navigateTree() moves the Pi runtime to that checkpoint leaf before the next prompt.

A checkpoint without transcriptRef is rejected for a non-empty Pi transcript to prevent state split-brain.

## Transcript-aware execution recovery

Recovery now consumes:
- run_id;
- tool_call_id;
- selected Pi branch tool calls;
- selected Pi branch terminal tool results;
- filesystem before/after hashes for workspace edits.

A shell/test execution with a matching terminal tool result can be finalized from the transcript without replay. A journal tool call missing from the selected branch becomes a correlation_conflict rather than silently falling back to an unrelated transcript state.

## Current regression gate

- Current runtime: **118 passed tests + 1 live-only skipped test across 70 test files**.
- Node 22.19.0: **118 passed tests + 1 live-only skipped test across 70 test files**.
- TypeScript typecheck: passed.
- Build: passed.
- Lint: passed.
- CLI launch on Node 22.19.0: passed.
- npm audit: **0 vulnerabilities**.

Remaining external release gates are unchanged: live configured provider evidence, Linux CI execution result, real-model paired coding benchmark, project license selection, and the reference 60-second idle CPU measurement.

Node 22.19.0 continues to emit the upstream ExperimentalWarning for node:sqlite.

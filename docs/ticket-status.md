# Ticket Implementation Status

Post-review hardening status, 2026-09-19.

| Ticket | Implementation | Evidence gate |
| --- | --- | --- |
| T-001 | Done | Bootstrap/build/typecheck pass |
| T-002 | Done | Pi mock nested-turn + session integration pass; live external provider pending |
| T-003 | Done | Trusted config/path/secret policy regression pass |
| T-004 | Done | Durable state, migration, lock and recovery tests pass |
| T-005 | Done | Policy, force-kill, secret redaction and TOCTOU tests pass |
| T-006 | Done | Hard pre-network request-budget gate verified |
| T-007 | Done | CLI local/Node 22 pass |
| T-008 | Done | Baseline/paired harness implemented; live-model baseline pending |
| T-009 | Done | Bounded search + stale cursor generation tests pass |
| T-010 | Done | Structural index + exclusion/invalidation tests pass |
| T-011 | Done | Smart read/repo map policy path pass |
| T-012 | Done | WorkingSet is wired into runtime selection path |
| T-013 | Done | Actual provider-payload manifest/gate integration pass |
| T-014 | Done | Current-source freshness replacement integration pass |
| T-015 | Done | AgentHarness wired to Pi runtime; provider-turn hard gate pass |
| T-016 | Done | run_test durable structured evidence wired end-to-end |
| T-017 | Done | Real temporary Git fixture + diff/review freshness pass |
| T-018 | Done | Runtime ledger + checkpoint state pass |
| T-019 | Done | Pre-compaction ledger/checkpoint coordination + cancellation pass |
| T-020 | Done | Lightweight graph + file/dangling invalidation pass |
| T-021 | Done | Relationship tools retain partial/uncertain coverage semantics |
| T-022 | Done | Recovery/migration/checkpoint/log/Git/process matrix pass |
| T-023 | Done | 10k/~102.4 MB Node 22 reference retrieval benchmark + paired mock harness; live-model benchmark pending |
| T-024 | Done | Package/audit/Node 22 clean-install/CI/docs implemented; external release evidence pending |

## Regression gate

- Current runtime: **134 passed tests + 1 live-only skipped test across 76 files**.
- Node 22.19.0: **134 passed tests + 1 live-only skipped test across 76 files**.
- Typecheck, lint and build: passed.
- npm audit: 0 known vulnerabilities.
- TypeSafe direct live transport and installed-package Jev shadow integration: passed.

"Done" means the ticket's implementation path is wired and its locally executable acceptance evidence passes. It does not assert production-ready V1 while external release gates remain unresolved.

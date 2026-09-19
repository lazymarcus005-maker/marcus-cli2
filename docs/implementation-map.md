# Macus Code Implementation Map

This map connects the v1.1 specification and tickets to the current modules.

| Area | Tickets | Implementation |
| --- | --- | --- |
| Bootstrap/runtime | T-001 | package.json, tsconfig.json, .node-version, README.md |
| Pi compatibility/kernel | T-002 | src/agent/kernel.ts, src/agent/provider-runtime.ts, src/agent/tools.ts, src/agent/tool-outcome.ts, src/agent/tool-result-coordinator.ts |
| Config/trust/instructions | T-003 | src/config.ts, src/instructions.ts |
| State/session/journal/lock | T-004 | src/storage/state.ts, src/storage/lock.ts |
| Policy/file/process safety | T-005 | src/policy.ts |
| Request budget/manifests | T-006, T-013 | src/context/budget.ts, src/context/manifest-store.ts |
| CLI/session UX | T-007 | src/cli.ts, src/cli/application.ts, src/cli/commands.ts, src/cli/registry.ts |
| Benchmark harness | T-008, T-023 | src/benchmark.ts |
| Search | T-009 | src/retrieval/search.ts |
| Tree-sitter/index | T-010 | src/retrieval/symbols.ts, src/retrieval/index.ts |
| Smart reads/repo map | T-011 | src/retrieval/symbols.ts, src/retrieval/index.ts, repo_map tool |
| Working set/selector | T-012 | src/context/working-set.ts |
| Change-aware context | T-014 | source hashes, index refresh, request manifest contracts |
| Tasks/workflow | T-015 | src/workflow/tasks.ts, src/workflow/harness.ts |
| Test evidence | T-016 | src/testing/evidence.ts, src/verification/assessment.ts |
| Git/review | T-017 | src/repository.ts, src/review.ts |
| Ledger/checkpoints | T-018 | src/context/ledger.ts, src/storage/checkpoint.ts, src/runtime/durable-continuity.ts |
| Compaction | T-019 | PiAgentKernel compaction + src/runtime/durable-continuity.ts |
| Graph | T-020 | src/graph/graph.ts |
| Relationship tools | T-021 | find_references/find_dependencies/find_dependents/impact tools |
| Recovery hardening | T-022 | journal/lock/checkpoint implementation plus recovery tests |
| Packaging/release | T-024 | package bin, README, evidence docs, npm pack validation |

## Architectural Notes

- Pi remains the model/tool-loop kernel. Macus uses public SDK/extension surfaces.
- Built-in Pi mutation/bash tools are disabled in the created session; Macus exposes policy-owned tools instead.
- Durable state and rebuildable cache are separate SQLite databases.
- The request budget guard runs on Pi's before_provider_request hook and uses ExtensionContext.abort() as the hard pre-network gate because Pi catches handler exceptions.
- Graph output is explicitly partial and candidate/unresolved unless evidence is strong enough for confirmed containment.

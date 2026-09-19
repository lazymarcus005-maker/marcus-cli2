# Marcus Code Improvement Plan

Date: 2026-09-19
Baseline: 118 passed tests + 1 live-only skipped test across 70 test files
Theme: Runtime simplification, scalability, and operator UX

## 1. Objective

Marcus Code has reached a strong correctness and safety baseline. The next phase should focus on making the current system lighter, faster, easier to maintain, and easier to operate before adding more intelligence.

Preserve the current guarantees around source freshness, trusted test evidence, task/evidence binding, checkpoint and recovery, execution correlation, context budgets, path/secret policy, and bounded runtime behavior.

Guiding principle:

> Reduce orchestration complexity before adding new intelligence.

## 2. Current baseline

Current implementation status:

- 118 passed tests + 1 live-only skipped test passing;
- 70 test files;
- typecheck/build/lint passing;
- Node 22.19.0 validation passing;
- npm audit reports 0 vulnerabilities;
- adversarial coverage exists for trusted evidence, source snapshot races, checkpoint restore, transcript recovery, timeout/cancellation, Git review, and context freshness.

The main remaining issues are architectural and operational rather than basic correctness defects:

1. a durable session is created immediately on CLI startup;
2. read-only prompts acquire the mutation lock;
3. evidence freshness repeatedly hashes the full workspace;
4. PiAgentKernel owns too many responsibilities;
5. persistence SQL leaks through multiple modules;
6. trusted-test refresh has poor operator UX;
7. CLI dispatch will become difficult to extend;
8. interactive output is too JSON-heavy;
9. automation/non-interactive execution is not yet a first-class interface.

# 3. P0 — Runtime efficiency and lifecycle

## IMP-001 — Lazy session creation

### Problem

Current startup creates a durable session immediately, captures a trusted-command baseline, and may then immediately abandon that session when the user chooses /resume.

### Target behavior

```text
CLI start
   ↓
session = none

/help, /models, /settings
   ↓
no session required

/resume <id>
   ↓
attach existing session

first normal prompt
   ↓
create new session lazily

/clear
   ↓
explicitly create a new session
```

Suggested CLI forms:

```bash
macus --resume <sessionId>
macus --resume <sessionId> "continue the task"
```

### Acceptance criteria

- Starting and exiting without a prompt creates no session.
- /help, /models, and /settings create no session.
- /resume does not create an intermediate session.
- First normal prompt creates exactly one durable session.
- Trust baseline is captured only when a new session is actually created.
- Existing checkpoint/resume semantics remain compatible.

Suggested tests:

```text
tests/lazy-session.test.ts
tests/cli-resume-startup.test.ts
```

## IMP-002 — Separate read-only runtime from mutation lock

### Problem

Kernel creation currently acquires the worktree mutation lock even for read-only analysis. This prevents multiple read-only Macus processes from inspecting the same worktree concurrently.

### Target behavior

Read-only operations do not require the exclusive mutation lock. Effectful operations acquire it lazily.

Read-only examples:

- repository map;
- code search;
- symbol lookup;
- read range;
- context inspection;
- architecture analysis;
- task/status inspection.

Lock-required operations:

- write_file;
- shell execution;
- test/build execution;
- checkpoint select/restore;
- recovery mutation;
- future effectful tools.

Authorization and locking remain separate concepts:

```text
authorization = may the agent perform this effect?
lock          = may this worktree be mutated safely now?
```

Suggested component:

```text
RuntimeLockCoordinator
├── ensureReadAccess()
└── ensureMutationAccess()
```

### Acceptance criteria

- Two read-only processes can inspect one worktree concurrently.
- First effectful operation acquires the exclusive lock.
- A second mutator fails closed.
- Existing authorization behavior is unchanged.
- Shell/test execution still requires mutation ownership.
- Recovery/checkpoint restore always owns the mutation lock.

Suggested tests:

```text
tests/read-only-concurrency.test.ts
tests/mutation-lock-escalation.test.ts
```

## IMP-003 — Incremental workspace snapshot cache

### Problem

Trusted test evidence computes a full workspace content digest before and after test execution, and /review may compute it again. This is correct but will become expensive on large repositories.

### Target architecture

Create a WorkspaceSnapshotStore with records similar to:

```text
path
size
mtime_ns
content_hash
last_verified
generation
```

Workspace digest remains content-derived:

```text
sha256(sorted(path + content_hash))
```

Update strategy:

```text
Macus write_file
   ↓
afterHash already known
   ↓
update cache immediately

external edit
   ↓
file identity changed
   ↓
rehash changed file

unchanged file
   ↓
reuse cached content hash
```

Safety rule: when cache state is uncertain, rehash. Never assume unchanged.

### Acceptance criteria

- Same-size changes are detected.
- Restored mtime does not preserve a stale digest.
- Macus writes update cache immediately.
- External edits invalidate evidence.
- Warm verification reads substantially fewer bytes than cold verification.

### Benchmark

Use repositories of approximately 100 files, 2,000 files, and a synthetic 10,000-file / ~1 GB repository.

Capture cold digest, warm digest, one-file-change digest, run_test evidence overhead, /review latency, and context-preparation latency.

Primary criterion:

> Warm verification should scale primarily with changed files, not total repository bytes.

# 4. P1 — Architecture simplification

## IMP-004 — Split PiAgentKernel responsibilities

PiAgentKernel currently owns Pi session lifecycle, model runtime, request interception, source freshness, context selection, manifests, working set, run harness, no-progress handling, ledger persistence, compaction checkpoints, transcript navigation, model switching, authorization forwarding, and tool-result processing.

### Target architecture

```text
src/
├── agent/
│   ├── kernel.ts
│   ├── pi-session.ts
│   └── tool-result-coordinator.ts
├── runtime/
│   ├── run-controller.ts
│   ├── authorization.ts
│   └── lock-coordinator.ts
├── context/
│   ├── coordinator.ts
│   ├── freshness.ts
│   ├── selector.ts
│   ├── working-set.ts
│   └── manifest-store.ts
└── storage/
    ├── ledger-coordinator.ts
    └── checkpoint-coordinator.ts
```

PiAgentKernel should focus on:

```text
create()
prompt()
abort()
compact()
switchModel()
branchTranscript()
dispose()
```

Suggested ownership:

- RunController: run ID, hard deadline, turn limit, no-progress, durable finalization.
- ContextCoordinator: freshness, selection, category budgets, omissions, request manifest.
- ToolResultCoordinator: working-set updates, progress/failure classification, source hash updates, task/evidence reactions.
- LedgerCoordinator: hydrate, persist, decisions, checkpoint projection.

### Acceptance criteria

- Kernel becomes primarily orchestration.
- Public behavior remains compatible.
- Existing regression tests stay green.
- New modules are individually testable.
- Freshness and finalization logic each have one owner.

## IMP-005 — Introduce storage repository APIs

### Problem

Several runtime modules directly call store.db.prepare(...), coupling them to the SQLite schema.

### Recommended V1 structure

Keep one lightweight StateStore but expose domain APIs:

```text
StateStore
├── sessions
├── runs
├── executions
├── tasks
├── evidence
├── ledger
├── checkpoints
└── trust
```

Examples:

```ts
store.evidence.listRecent(sessionId, 20)
store.ledger.latest(sessionId)
store.executions.listUnknown(sessionId)
```

Minimum APIs:

```text
sessions.create/get/validate
runs.create/finish
executions.prepare/finish/listUnknown
tasks.list/replaceAll/upsert
evidence.record/listRecent/latest
ledger.append/latest
checkpoints.record/list/invalidate
trust.get/replace
```

### Acceptance criteria

- CLI contains no raw SQL.
- Review contains no raw SQL.
- Kernel contains no raw SQL.
- Evidence/recovery/checkpoint use storage APIs.
- Transaction boundaries remain explicit.

## IMP-006 — CLI command registry

Replace the growing if/else command dispatcher with a registry.

Suggested API:

```ts
interface CliCommand {
  name: string;
  aliases?: string[];
  usage: string;
  description: string;
  requiresSession?: boolean;
  requiresMutationLock?: boolean;
  execute(ctx: CliContext, args: string[]): Promise<void>;
}
```

Suggested structure:

```text
src/cli/
├── app.ts
├── context.ts
├── registry.ts
└── commands/
    ├── authorize.ts
    ├── checkpoint.ts
    ├── context.ts
    ├── diff.ts
    ├── model.ts
    ├── resume.ts
    ├── review.ts
    ├── status.ts
    ├── tasks.ts
    └── trust.ts
```

Acceptance criteria:

- Existing syntax remains compatible.
- /help is generated from registry metadata.
- Unknown command behavior remains deterministic.
- Individual commands can be tested without the full readline loop.

## IMP-007 — Trusted-test operator UX

Add:

```text
/trust status
/trust diff
/trust refresh
```

/trust status should show whether each trusted command's baseline source is unchanged.

/trust diff should show changed trust sources, baseline/current hashes, and command additions/removals without displaying secrets.

/trust refresh must be a user-only CLI action and must never be exposed as an agent tool.

Suggested confirmation:

```text
Trust definitions changed:

  package.json
    baseline: 8abc...
    current:  4def...

Commands after refresh:
  npm test
  npm run test:e2e

Refresh trust baseline for this session? [y/N]
```

Safety invariant:

> The model must never be able to refresh or elevate its own test authority.

Acceptance criteria:

- Agent cannot invoke trust refresh.
- User can establish a new baseline without losing transcript/tasks.
- Refresh is durable and auditable.
- Existing evidence remains associated with its original trust baseline.

# 5. P2 — Operator and automation UX

## IMP-008 — Human terminal dashboard

Default human output should become concise rather than raw JSON.

Example:

```text
Marcus Code

Session   session_01J...
Model     primary
Branch    feature/context-cache
Context   38k / 131k
Run       coding
Auth      edits ✓  shell ✓

Tasks
  ✓ Inspect repository
  ● Implement snapshot cache
  ○ Run tests
  ○ Review changes

Evidence
  ✓ npm test       118 passed / 1 live-only skipped
  ✓ typecheck
  ✓ build

Changes
  M src/context/snapshot.ts
  M tests/snapshot.test.ts

Risks
  none
```

Human commands:

```text
/status
/tasks
/review
/context
```

Machine versions:

```text
/status --json
/tasks --json
/review --json
/context --json
```

## IMP-009 — First-class non-interactive JSON mode

Support automation under Hermes, GitLab Runner, CI, shell scripts, and other orchestration agents.

Suggested usage:

```bash
macus --json "review this repository"
macus --resume session_abc --json "continue"
```

Suggested result envelope:

```json
{
  "sessionId": "session_...",
  "runId": "run_...",
  "status": "completed",
  "result": "...",
  "tasks": [],
  "evidence": [],
  "remainingRisk": []
}
```

Suggested exit codes:

```text
0 completed
1 runtime/internal error
2 blocked by policy or authorization
3 verification/test failure
4 recovery/correlation conflict
5 context/model limit
```

Rules:

- no interactive prompt in --json mode;
- stdout contains valid JSON only;
- diagnostics go to stderr;
- exit codes are deterministic;
- checkpoint/resume failures use structured envelopes.

## IMP-010 — Lightweight runtime metrics

Keep metrics local; do not add an external telemetry backend for V1.

Track:

```text
session startup ms
provider TTFT
provider request tokens
selected context tokens
context preparation ms
source-hash cache hit/miss
search latency
repo-map latency
snapshot digest latency
test duration
checkpoint duration
recovery duration
SQLite latency
```

Expose via /metrics or /status performance.

# 6. Recommended implementation phases

## Phase 8A — Lifecycle and performance

```text
IMP-001 Lazy session creation
IMP-002 Read-only/mutation lock separation
IMP-003 Incremental workspace snapshot
```

Exit criteria:

- passive startup creates no session;
- concurrent read-only processes work;
- one mutator remains enforced;
- warm evidence/review avoids full repository re-read;
- safety tests stay green.

## Phase 8B — Architecture cleanup

```text
IMP-005 Storage repository APIs
IMP-004 Split PiAgentKernel
IMP-006 CLI command registry
```

Storage abstraction should precede the kernel split because reducing persistence coupling first makes orchestration extraction safer.

Exit criteria:

- kernel is materially smaller;
- CLI has no persistence SQL;
- command routing is declarative;
- context/run/storage components are independently testable.

## Phase 8C — Operator experience

```text
IMP-007 Trust UX
IMP-009 JSON/non-interactive mode
IMP-008 Terminal dashboard
IMP-010 Local runtime metrics
```

Exit criterion: Marcus Code works comfortably for both human operators and automation/orchestration agents without separate implementations.

# 7. Suggested target architecture

```text
CLI / JSON API
      │
      ▼
Application Runtime
├── SessionCoordinator
├── RunController
├── LockCoordinator
├── AuthorizationService
└── CommandRegistry
      │
      ▼
PiAgentKernel
├── PiSessionAdapter
├── ContextCoordinator
└── ToolResultCoordinator
      │
      ├───────────────┐
      ▼               ▼
Tool Layer       Workflow Layer
                ├── Tasks
                ├── Review
                └── Harness
      │
      ▼
Policy / Safety
├── PathPolicy
├── ExecutionPolicy
├── TrustPolicy
└── EvidencePolicy
      │
      ▼
StateStore
├── sessions
├── runs
├── executions
├── tasks
├── evidence
├── ledger
├── checkpoints
├── trust
└── workspace snapshots
```

Keep the system local-first and lightweight. Avoid Redis, external queues, vector databases, graph databases, or background control-plane services unless a future requirement demonstrates a concrete need.

# 8. Features that should wait

Do not prioritize these before Phase 8 is complete:

- semantic/vector search;
- multi-agent orchestration;
- automatic Git push/MR;
- remote execution;
- plugin marketplace;
- distributed workers;
- large graph intelligence layer;
- autonomous trust-policy modification.

Current code search, symbol index, repo map, working set, and graph-lite are sufficient for V1 while the runtime is simplified.

# 9. Performance benchmark plan

Benchmark the same repositories before and after Phase 8A:

```text
Small:  ~100 files
Medium: ~2,000 files
Large:  10,000 files / ~1 GB synthetic
```

Capture:

| Metric | Cold | Warm | One-file change |
| --- | ---: | ---: | ---: |
| CLI startup | | | |
| Session creation | | | |
| Trust discovery | | | |
| Repo map | | | |
| Search | | | |
| Workspace digest | | | |
| run_test evidence overhead | | | |
| /review | | | |
| Context preparation | | | |

Primary criterion:

> Warm verification should scale primarily with changed files, not total repository bytes.

# 10. Migration constraints

Preserve existing durable state where practical. Do not silently discard sessions, Pi transcripts, ledger revisions, tasks, evidence, checkpoints, execution journal, or trust snapshots.

If schema changes are required:

1. add an explicit SQLite migration;
2. test upgrade from the current schema;
3. keep migrations idempotent;
4. fail closed on unsupported future schema.

# 11. Regression requirements

Each phase must continue to run:

```bash
npm test
npm run typecheck
npm run build
npm run lint
npm audit --audit-level=low
```

Target runtime:

```bash
npx -y node@22.19.0 node_modules/vitest/vitest.mjs run
npx -y node@22.19.0 dist/cli.js --help
```

Existing adversarial tests must remain intact. Do not weaken regression tests simply to make architectural refactoring pass.

# 12. Definition of Done

Phase 8 is complete when:

- passive startup does not create unnecessary sessions;
- read-only work does not hold an exclusive mutation lock;
- one mutator per worktree is still enforced;
- workspace freshness uses an incremental content-safe cache;
- PiAgentKernel no longer acts as a God Object;
- persistence access is behind stable storage APIs;
- CLI commands use a registry;
- trusted test state is visible and user-refreshable without letting the agent elevate trust;
- terminal output is useful to humans;
- structured JSON mode is usable by automation;
- runtime performance is measurable locally;
- current safety/recovery guarantees remain intact;
- the complete regression suite passes on Node 22.19.x.

# 13. Recommended execution order

```text
1. IMP-001 Lazy session creation
2. IMP-002 Read-only/mutation lock separation
3. IMP-003 Incremental workspace snapshot
4. IMP-005 Storage repository APIs
5. IMP-004 Split PiAgentKernel
6. IMP-006 CLI command registry
7. IMP-007 Trust UX
8. IMP-009 JSON/non-interactive mode
9. IMP-008 Terminal dashboard
10. IMP-010 Runtime metrics
```

The three highest-value improvements are:

```text
Incremental Workspace Snapshot
        ↓
Lazy / Concurrent Runtime
        ↓
PiAgentKernel Decomposition
```

These improve speed, usability, and maintainability without expanding Marcus Code beyond its intended role as a lightweight coding-agent runtime.


# Jev integration status

The Jev harness PoC described in `jev_improve-handoff.md` has been implemented through the shadow-evaluation stage. It remains default-OFF and does not change the Phase 8 priorities above. Advisory/routing promotion is intentionally deferred until `docs/jev-benchmark.md` and `docs/jev-calibration.md` contain sufficient workload evidence.

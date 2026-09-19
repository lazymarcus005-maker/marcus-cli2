# Macus Code Runbook

Date: 2026-09-19
Target runtime: Node.js 22.19.x
Package: `macus-code@0.1.0`
Status: implementation preview

This runbook describes how to install, configure, operate, recover, troubleshoot, and validate Macus Code from a real workspace.

Macus Code is a local-first CLI coding agent built around the Pi agent kernel. It keeps source access, execution policy, context selection, task state, test evidence, checkpoints, and recovery state in the local workspace.

---

## 1. Operating model

Macus Code runs from the repository or workspace that you want the agent to work on.

```text
your-project/
├── source files
├── package.json / *.sln / *.csproj / ...
└── .macus/
    ├── config.yaml
    ├── state/
    │   └── state.db
    ├── sessions/
    │   └── <sessionId>/
    ├── checkpoints/
    │   └── <sessionId>/
    ├── cache/
    │   └── index.db
    ├── logs/
    │   └── <sessionId>/
    └── metrics/
```

Macus Code does not require Docker, a vector database, a graph server, or a background daemon.

Important operating assumptions:

- one mutating Macus process is allowed per worktree;
- source edits and shell execution require explicit session authorization;
- shell execution is not an OS sandbox;
- checkpoints restore agent state, not source files;
- unknown side effects are never automatically replayed;
- trusted test/build commands are frozen at session creation;
- provider credentials come only from trusted user/global configuration.

---

## 2. Prerequisites

Required:

- macOS arm64 or Linux;
- Node.js `>=22.19.0 <23`;
- npm;
- Git;
- ripgrep (`rg`).

Verify:

```bash
node --version
npm --version
git --version
rg --version
```

Expected Node major/minor:

```text
v22.19.x
```

Node 22.19.x may emit an upstream warning that `node:sqlite` is experimental. That warning is currently expected.

---

## 3. Development installation

From the Macus Code source directory:

```bash
npm ci
npm run typecheck
npm run lint
npm run build
npm test
```

Expected current validation baseline:

```text
118 passed tests + 1 live-only skipped test
70 test files
typecheck: pass
build: pass
lint: pass
npm audit: 0 vulnerabilities
```

Start the CLI:

```bash
node dist/cli.js
```

Show help:

```bash
node dist/cli.js --help
```

After package installation, the command is:

```bash
macus
```

A one-shot initial prompt can also be supplied:

```bash
macus "inspect this repository and explain the architecture"
```

---

## 4. Configuration

### 4.1 Configuration precedence

User/global configuration:

```text
~/.macus/config.yaml
```

Alternative global configuration:

```bash
export MACUS_CONFIG=/path/to/config.yaml
```

or:

```bash
macus --config /path/to/config.yaml
```

Project configuration:

```text
<workspace>/.macus/config.yaml
```

Project configuration has intentionally less authority than global configuration. A project may select a trusted model alias and lower bounded context budgets, but it cannot define arbitrary provider credentials/endpoints or weaken the execution policy.

### 4.2 Example global configuration

Use `docs/config.example.yaml` as the reference.

Example:

```yaml
schema_version: 1

models:
  default: primary
  providers:
    private_gateway:
      protocol: openai-compatible
      base_url: ${MACUS_MODEL_BASE_URL}
      api_key_env: MACUS_MODEL_API_KEY
      profile: standard
      model: your-model-id
  aliases:
    primary: private_gateway

model_profiles:
  standard:
    context_window: 131072
    max_output_tokens: 8192
    tokenizer: conservative-byte-estimate

context:
  reserved_output_tokens: 8192
  safety_margin_tokens: 2048
  target_prompt_ratio: 0.55
  compact_prompt_ratio: 0.72
  emergency_prompt_ratio: 0.85
  budget:
    repo_map_tokens: 1200
    search_results_tokens: 2500
    tool_output_tokens: 5000
    single_file_read_tokens: 8000

features:
  repo_map: true
  code_graph: false
  context_ledger: true
  checkpoint: true
  auto_compaction: true
  git_context: true
  task_engine: true
  prompt_cache_optimization: true
  semantic_search: false
  telemetry: false
```

### 4.3 Provider environment

Typical environment:

```bash
export MACUS_MODEL_BASE_URL="https://your-gateway.example/v1"
export MACUS_MODEL_API_KEY="..."
```

Do not put the API key directly in project configuration.

Macus removes configured provider credential environment variables from tool subprocess environments by default.

Check resolved settings:

```text
/settings
```

Sensitive provider values are redacted from the displayed result.

---

## 5. Starting a normal work session

Run Macus from the root of the target repository:

```bash
cd /path/to/project
macus
```

A new durable session is created immediately.

Recommended initial checks:

```text
/status
/models
/model
/settings
```

Then give the agent a read-only task first:

```text
Inspect this repository and explain the main runtime flow.
```

No mutation authorization is required for repository discovery/read operations.

---

## 6. Authorization model

Macus fails closed for source mutation and shell execution.

Authorize source edits:

```text
/authorize edits
```

Authorize shell commands:

```text
/authorize shell
```

Authorize both:

```text
/authorize all
```

Authorization is session-local.

It is cleared when:

- `/clear` starts a new session;
- `/resume <sessionId>` switches sessions;
- `/checkpoint select <id>` restores an older agent state.

After any of these operations, authorize again before allowing edits or shell commands.

### Shell warning

`/authorize shell` allows repository commands and scripts to start local processes.

Macus bounds execution duration/output and maintains an execution journal, but V1 is not an OS-level sandbox.

Use shell authorization only in repositories/scripts you are willing to execute locally.

---

## 7. Main CLI commands

### Session and configuration

```text
/help
/status
/model
/model <alias>
/models
/settings
/clear
/resume <sessionId>
/exit
```

### Context

```text
/context
/context files
/compact
```

`/context` displays the most recent provider request manifest.

`/context files` is useful when debugging what source fragments were actually included or omitted.

The manifest separates categories such as:

- repository map;
- search results;
- working source;
- other tool output.

Historical source that fails freshness validation is omitted before the provider request.

### Tasks

```text
/tasks
```

The task engine is durable when enabled.

Only one task may be `in_progress` per session.

### Git/review

```text
/diff
/review
```

`/diff` includes bounded staged and unstaged Git changes.

`/review` reports:

- Changed;
- Tested;
- TaskEvidence;
- RemainingRisk;
- UnresolvedIssue.

Do not treat a visually successful model response as completion evidence. Use `/review` before accepting work.

### Checkpoints

```text
/checkpoint
/checkpoint create
/checkpoint list
/checkpoint select <checkpointId>
```

A checkpoint captures durable agent state and Pi transcript position.

It does not copy or roll back source bytes.

---

## 8. Trusted test/build evidence

Macus distinguishes shell execution from trusted verification evidence.

At session creation it snapshots:

- recognized test/build command strings;
- the project file that authorized each command;
- the content hash of that trust source.

Recognized Node script names include:

```text
test
test:*
build
build:*
check
check:*
typecheck
lint
```

For .NET, discovered commands include:

```text
dotnet test <project.csproj>
dotnet test <solution.sln>
```

### Important: trust baseline is immutable inside a session

Suppose the session starts with:

```json
{
  "scripts": {
    "test": "vitest run"
  }
}
```

Then the agent modifies `package.json`.

Even if the new script is still named `test`, it is no longer trusted for evidence in that session because the trust-source hash changed.

The command may still execute after shell authorization, but its result remains:

```text
status = unknown
```

instead of becoming trusted `passed`.

If you intentionally changed the project's test/build definition and want the new command to become a valid trusted baseline:

1. inspect the change yourself;
2. exit or use `/clear`;
3. start a new session;
4. re-authorize mutation/shell scopes as required.

This prevents an agent from editing its own verification policy and then declaring itself green.

---

## 9. Structured test reports

Macus supports structured JUnit and TRX evidence.

A report is only usable as passing evidence when all relevant safety checks succeed.

The report must:

- stay inside the workspace;
- not resolve outside the workspace through a symlink;
- not be inside denied/internal/secret paths;
- be fresh for the current execution;
- remain within parser size limits;
- parse completely and consistently;
- correspond to the same repository/source snapshot being reviewed.

Inconsistent report counters fail closed.

Example:

```xml
<testsuites tests="2" failures="0">
  <testsuite tests="2" failures="1" />
</testsuites>
```

This is not accepted as green evidence.

---

## 10. Source freshness model

Macus attaches content hashes to source-bearing tool results.

Covered paths include:

- `read_range`;
- `search_code`;
- `search_symbol`;
- `repo_map`.

Before source-bearing historical results are sent back to the model, they are revalidated.

If the file changed, the old result is omitted from effective model context.

Typical omission reasons include:

```text
superseded_source
external_source_change
stale_repo_map
unverified_search_source
```

Search cursor generation is based on actual content, not only size and modification time.

A same-size file edit with a restored mtime still invalidates the old cursor.

---

## 11. Checkpoints

### Create

```text
/checkpoint
```

or:

```text
/checkpoint create
```

The command returns the checkpoint ID.

### List

```text
/checkpoint list
```

### Select/restore

```text
/checkpoint select checkpoint_<id>
```

Restore behavior:

1. validate checkpoint schema and session/repository identity;
2. validate the checkpoint Pi transcript reference;
3. re-hash checkpoint working files;
4. restore tasks and ledger atomically;
5. reconcile unknown executions against the selected Pi transcript branch;
6. navigate Pi back to the checkpoint transcript leaf;
7. preserve current source bytes.

If source changed after the checkpoint:

```text
source rollback = false
file status     = stale
next action     = revalidate
```

This is intentional.

### Checkpoint does not mean Git rollback

Never expect:

```text
/checkpoint select ...
```

to perform:

```text
git checkout
git reset
source file restoration
```

Use Git explicitly if source rollback is required.

---

## 12. Resume and crash recovery

List or record the current session ID using:

```text
/status
```

Resume later:

```text
/resume <sessionId>
```

Resume performs recovery work before continuing.

Recovery includes:

- checkpoint temp/orphan reconciliation;
- durable execution journal reconciliation;
- Pi transcript correlation;
- workspace edit before/after hash checks;
- run ID and Pi tool-call ID validation.

Unknown effects are never replayed automatically.

Possible recovery findings include:

```text
completed_on_disk
completed_from_transcript
failed_from_transcript
cancelled_from_transcript
not_applied
conflict
correlation_conflict
unknown_external_effect
```

### Meaning of correlation_conflict

Example:

```text
journal tool_call_id = tc-123
selected Pi branch   = does not contain tc-123
```

Macus preserves the execution as unknown and does not assume the effect happened.

Investigate manually before continuing.

---

## 13. Recovery playbooks

### 13.1 Macus process crashed during a file write

Restart from the same worktree:

```bash
macus
```

Then resume the previous session:

```text
/resume <sessionId>
```

Macus compares durable before/after hashes against the current file.

Possible outcomes:

- current hash matches expected after-hash → operation can be reconciled as completed;
- current hash matches before-hash → operation was not applied;
- neither matches → conflict; manual inspection required.

Do not manually replay an unknown edit until recovery output is understood.

### 13.2 Process crashed during shell/test execution

Resume:

```text
/resume <sessionId>
```

If Pi transcript contains a matching terminal tool result, Macus can finalize the journal row from that result.

If no terminal result can prove the side effect:

```text
unknown_external_effect
```

Macus will not automatically rerun the command.

### 13.3 Checkpoint restore fails

Run:

```text
/checkpoint list
```

Common causes:

- checkpoint file missing;
- future/corrupt schema;
- wrong session;
- repository/worktree identity mismatch;
- transcript reference no longer valid.

Invalid committed checkpoint files are marked incomplete.

Checkpoint task/ledger restore uses one SQLite transaction, so a mid-restore failure should not leave a partially restored task set.

### 13.4 Mutation lock error

Symptom:

```text
another Macus mutator already owns the worktree lock
```

Check for another active Macus process working in the same worktree.

Only one mutating process should run against a worktree.

Do not delete lock files blindly while another process may still be alive.

### 13.5 Context budget blocked

Inspect:

```text
/context
/context files
```

Then consider:

- reducing search scope;
- reading a smaller line range;
- reducing project context budgets;
- running `/compact`;
- using a model profile with a larger context window.

The provider request gate aborts before HTTP dispatch when the effective prompt exceeds configured context capacity.

### 13.6 Search cursor is stale

Re-run the search without the previous cursor.

A cursor becomes invalid when source content in the search scope changes.

### 13.7 Test command unexpectedly becomes untrusted

Check whether a trust-source file changed after session start:

```text
package.json
*.sln
*.csproj
```

If the change was intentional and reviewed, create a new session:

```text
/clear
```

Then re-authorize required scopes.

---

## 14. Secret and path policy

Macus denies known secret/internal files independently from `.gitignore`.

Examples include:

```text
.env
.env.local
.env.production
.npmrc
.pypirc
.netrc
.git-credentials
*.pem
*.key
*.p12
*.pfx
*.jks
*.keystore
id_rsa*
id_ed25519*
id_ecdsa*
credentials.json
secrets.json
service-account*.json
.aws/credentials
.docker/config.json
```

Internal/build paths also include:

```text
.git/
.macus/
node_modules/
dist/
build/
coverage/
.next/
bin/
obj/
```

Safe template environment files such as these are allowed:

```text
.env.example
.env.sample
.env.template
.env.defaults
```

Symlinks that resolve outside the workspace are rejected.

---

## 15. Compaction

Manual:

```text
/compact
```

Auto-compaction is controlled by:

```yaml
features:
  auto_compaction: true
```

Before Pi compaction, Macus persists durable state/checkpoint information.

The compacted state should preserve:

- user goal;
- active task;
- durable decisions;
- working files;
- blockers;
- unresolved failures;
- unknown executions;
- next action.

If pre-compaction checkpointing fails, compaction is cancelled rather than discarding recovery state.

---

## 16. Task workflow

Recommended operational flow:

```text
discover
  ↓
understand source
  ↓
plan / create task
  ↓
task = in_progress
  ↓
edit
  ↓
run trusted test/build
  ↓
attach evidence to active task
  ↓
task = completed
  ↓
/review
```

A completed task without fresh linked passing evidence is reported as a remaining risk.

A global green test result is not sufficient to satisfy an unrelated completed task.

---

## 17. Review before accepting work

Always run:

```text
/diff
/review
```

Check:

### Changed

Confirm the actual staged/unstaged diff matches the requested work.

### Tested

Confirm latest evidence is:

```text
status = passed
fresh  = true
```

Freshness includes:

- source snapshot;
- repository identity;
- Git HEAD.

### TaskEvidence

Each completed task should have linked fresh passing evidence where applicable.

### RemainingRisk

Treat any entry here as unresolved until consciously accepted.

### UnresolvedIssue

Blocked tasks should be understood before considering the work complete.

---

## 18. Standard validation commands for Macus Code itself

From the Macus Code source workspace:

```bash
npm ci
npm run typecheck
npm run lint
npm run build
npm test
npm audit --audit-level=low
node dist/cli.js --help
```

Target-runtime test:

```bash
npx -y node@22.19.0 node_modules/vitest/vitest.mjs run
npx -y node@22.19.0 dist/cli.js --help
```

Current expected state:

```text
Vitest:       118 passed / 1 live-only skipped
Test files:   53
Typecheck:    PASS
Build:        PASS
Lint:         PASS
npm audit:    0 vulnerabilities
CLI launch:   PASS
```

---

## 19. Troubleshooting quick reference

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `Missing environment variable ...` | Provider API key/base URL env missing | Export required variables and restart |
| `Unknown trusted model alias` | Alias absent from global trusted config | Check `/models` and global config |
| Edit denied | No edit authorization | `/authorize edits` |
| Shell/test denied | No shell authorization | `/authorize shell` |
| Test ran but evidence = `unknown` | Command not in session trust baseline or trust source changed | Review project test config, then create a new session if intentional |
| Report rejected | Outside workspace, symlink escape, stale, oversized, or inconsistent | Fix report location/generation |
| `Stale source hash` | File changed after read | Re-read source before editing |
| Search cursor rejected | Source generation changed | Restart search without cursor |
| Old source omitted from context | File has newer hash | Re-read/re-search current source |
| Mutation lock failure | Another Macus mutator is active | Stop/finish the other session/process |
| `correlation_conflict` | Journal does not match selected Pi branch | Inspect transcript/execution before continuing |
| Checkpoint select rejected | Invalid/missing transcriptRef or identity mismatch | Choose another checkpoint or resume normally |
| Review says evidence stale | source, Git HEAD, or repo identity changed | Re-run trusted tests |
| Node SQLite ExperimentalWarning | Node 22 upstream API status | Expected currently |

---

## 20. Operational data handling

The following are durable:

- session records;
- task state;
- ledger revisions;
- execution journal;
- test evidence;
- checkpoint metadata/files;
- Pi transcript.

The source index/cache is rebuildable.

Do not manually edit `.macus/state/state.db` during normal operation.

Do not copy a checkpoint from another repository/worktree and expect it to restore. Repository and worktree identity are validated.

---

## 21. Backup guidance

For a lightweight local backup, preserve:

```text
project source
.macus/state/
.macus/sessions/
.macus/checkpoints/
```

The following can generally be rebuilt and are lower priority:

```text
.macus/cache/
.macus/logs/
.macus/metrics/
```

When restoring a backup, preserve the same project/worktree path when possible because session and repository identity checks intentionally prevent unsafe cross-worktree restore.

---

## 22. Release gate for Macus Code

Local implementation validation is currently green, but the V1 release gate remains open.

Required external evidence still pending:

1. live configured provider compatibility;
2. Linux CI execution result;
3. real-model Pi-vs-Macus paired coding benchmark;
4. project license selection;
5. reference 60-second idle CPU measurement.

Do not describe the current build as fully production-ready V1 until those gates are satisfied.

---

## 23. Evidence and engineering references

Implementation/review evidence:

```text
docs/final-implementation-report.md
docs/ticket-status.md
docs/recovery-matrix.md
docs/benchmark-report.md
docs/pi-compatibility.md
docs/review-fixes-round4-20260919.md
docs/phase-1-evidence.md
...
docs/phase-7-evidence.md
```

Primary source areas:

```text
src/cli.ts
src/agent/
src/context/
src/retrieval/
src/storage/
src/testing/
src/workflow/
src/policy.ts
src/path-policy.ts
src/review.ts
```

---

## 24. Recommended daily operator sequence

For normal coding work:

```text
1. cd <project>
2. macus
3. /status
4. /model
5. ask Macus to inspect/plan
6. /authorize edits          # only when ready to modify
7. /authorize shell          # only when tests/build are required
8. execute coding task
9. /tasks
10. /diff
11. /review
12. /checkpoint              # useful before stopping or risky next work
13. /exit
```

To continue later:

```text
1. macus
2. /resume <sessionId>
3. inspect recovery output
4. /status
5. re-authorize edits/shell if required
6. continue work
```

If test/build configuration changed intentionally during the previous session:

```text
1. review the changed trust-source files yourself
2. /clear
3. establish a new session trust baseline
4. re-authorize required scopes
5. rerun verification
```

This sequence keeps source state, trusted evidence, Pi transcript, durable tasks, and recovery state aligned.

---

## 25. Optional Jev Harness Decision Engine

Marcus Code can optionally use TypeSafe Jev as an internal harness decision model. The feature is experimental and **OFF by default**.

Jev is not a coding model and is not registered as a Pi-visible tool. In the current implementation it runs only in **shadow mode** and cannot change Marcus behavior.

Enable from trusted global/user configuration only:

```yaml
features:
  jev_harness: true

internal_models:
  jev:
    enabled: true
    transport: openrouter
    model: typesafe/jev-1.13
    api_key_env: OPENROUTER_API_KEY
    timeout_ms: 1500
    max_state_tokens: 8000
    mode: shadow
    decisions:
      failure_triage: true
      progress_judge: true
      review_risk: true
      stage_router: false
      context_rerank: false
      compaction_filter: false
```

Project configuration may disable `features.jev_harness`, but cannot enable or reconfigure the external decision provider.

Current shadow decisions:

- `failure_triage` after failed test/command execution;
- `progress_judge` after repeated failures;
- `review_risk` when the review tool runs.

Jev remains non-authoritative for shell/edit authorization, source freshness, test evidence, checkpoints, recovery replay, mutation locking, and hard run limits. Provider failure, timeout, malformed response, oversized state, or stale delayed response is soft-failed and recorded without failing the coding run.

Inspect local decision data:

```text
/status
/decisions
/decisions 50
```

Decision state is minimized and redacted. Marcus does not persist raw Jev request state by default; it stores the state digest, typed answers, resolved model, provider usage, latency, status and confidence summary.

Optional live connectivity test:

```bash
export OPENROUTER_API_KEY=...
npm run test:jev-live
```

The normal `npm test` suite does not require network access or a Jev credential.

Calibration status is documented in:

```text
docs/jev-benchmark.md
docs/jev-calibration.md
jev_improve-handoff.md
```

Do not enable advisory or limited-routing behavior until the shadow dataset has been evaluated and promotion criteria are met.

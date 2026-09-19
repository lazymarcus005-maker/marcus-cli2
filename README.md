# Macus Code

Macus Code is a local-first CLI coding agent built around the Pi agent kernel.

Status: implementation preview. Core tickets T-001 through T-024 are implemented, but the V1 release gate remains open for live-provider, Linux, full paired benchmark, and licensing evidence. See `docs/ticket-status.md` and `docs/phase-7-evidence.md`.

## Requirements

- macOS arm64 or Linux
- Node.js 22.19.x
- npm
- Git
- ripgrep

Tree-sitter and SQLite are local dependencies. No Docker, vector database, graph server, or background daemon is required.

## Install for development

```bash
npm ci
npm run typecheck
npm run lint
npm run build
npm test
```

Run:

```bash
node dist/cli.js --help
node dist/cli.js
```

Or after package installation:

```bash
macus
macus "inspect this repository"
```

## Configuration

Global config defaults to `~/.macus/config.yaml`. Project config is `.macus/config.yaml`.

Use `MACUS_CONFIG` to select another user/global config path, or `--config <path>` to override it. A complete example is in `docs/config.example.yaml`.

Project configuration may select a trusted model alias and lower bounded retrieval budgets, but it cannot define provider credentials/endpoints or weaken execution policy.

## Provider environment

```bash
export MACUS_MODEL_BASE_URL="https://your-trusted-gateway.example/v1"
export MACUS_MODEL_API_KEY="..."
```

Credentials are bound to trusted user/global provider configuration and are removed from tool subprocess environments by default.

## Explicit execution authorization

Macus fails closed for mutation and shell execution. Within an interactive session:

```text
/authorize edits
/authorize shell
/authorize all
```

Shell authorization means a repository command may execute arbitrary local process behavior. Macus V1 is **not an OS sandbox**.

Authorization is session-local and is cleared on `/clear` or `/resume`.

## Main commands

```text
/help
/status
/model [alias]
/models
/settings
/resume <sessionId>
/clear
/compact
/context
/context files
/tasks
/decisions [n]
/diff
/checkpoint
/review
/authorize edits|shell|all
/exit
```


## Optional Jev harness decisions

Marcus can optionally use TypeSafe Jev as an internal **shadow decision engine** for failure triage, progress judgment, and review risk. It is OFF by default and is not exposed as a Pi tool.

Enable it only from trusted global/user configuration; project config may disable it but cannot enable or reconfigure the external provider. The current runtime supports shadow mode only, so Jev decisions are recorded for evaluation and do not change authorization, test evidence, source freshness, recovery, hard run limits, or harness routing.

OpenRouter uses its dedicated Decisions endpoint rather than chat completions. The default pinned model is `typesafe/jev-1.13`. See `docs/config.example.yaml`, `docs/jev-implementation.md`, and `jev_improve-handoff.md`.

Inspect recorded shadow decisions with:

```text
/status
/decisions
```

Optional live validation is separate from the normal regression suite:

```bash
export OPENROUTER_API_KEY=...
npm run test:jev-live
```

## Storage

```text
.macus/
  config.yaml
  state/state.db
  sessions/<sessionId>/
  cache/index.db
  checkpoints/<sessionId>/
  logs/<sessionId>/
  metrics/
```

Durable state and rebuildable source index are separate. Checkpoints restore agent state only; they never roll source files back.

## Safety model

- actual provider requests are checked against model context budgets;
- old source read results are suppressed from effective request content after a newer hash is observed;
- workspace writes require an expected content hash and atomic replacement;
- shell/edit paths go through PolicyExecutor and durable execution journal;
- unknown side effects are not automatically replayed after recovery;
- one mutating Macus process is allowed per worktree;
- large process output is bounded and spooled to disk;
- model credentials are redacted and not inherited by subprocesses by default.

## Validation and evidence

See `docs/pi-compatibility.md`, `docs/implementation-map.md`, `docs/phase-1-evidence.md` through `docs/phase-7-evidence.md`, `docs/recovery-matrix.md`, `docs/benchmark-report.md`, and `docs/ticket-status.md`.

## Known limitations

- The current tunnel session does not expose a real `MACUS_MODEL_BASE_URL` / `MACUS_MODEL_API_KEY`, so live provider compatibility and paired model benchmark evidence remain pending.
- Linux is covered by CI configuration but has not been executed in this local session.
- Node 22.19.0 still emits an ExperimentalWarning for the built-in `node:sqlite` API.
- The relationship graph is intentionally syntax/lightweight and reports partial coverage for cross-file semantic relationships.
- V1 does not provide an OS sandbox, semantic embeddings, vector DB, source rollback, automatic publication, or automatic model routing.
- A project license for Macus Code itself has not been selected; do not publish as a licensed release until that decision is made.

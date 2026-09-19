# Jev Harness Integration — Handoff

Date: 2026-09-19
Project: Marcus Code
Status: J1 foundation + J2 shadow implementation completed; advisory/routing deferred pending calibration
Scope: Optional internal decision model for the Marcus harness

Implementation status:

- J1 decision foundation: implemented;
- J2 failure_triage / progress_judge / review_risk in shadow mode: implemented;
- J3 advisory: intentionally not promoted;
- J4 routing/context experiments: not implemented;
- live OpenRouter validation: available via `npm run test:jev-live`, not part of normal regression.

Primary references:

- TypeSafe — Introducing System One Models and Jev
  https://typesafe.ai/blog/introducing-system-one-models-and-jev
- TypeSafe quickstart
  https://docs.typesafe.ai/introduction/quickstart
- OpenRouter TypeSafe/Jev catalog
  Use a pinned Jev release for production experiments; do not rely on a moving `latest` alias for calibrated routing decisions.

---

# 1. Objective

Add Jev/System One to Marcus Code as an **optional internal decision engine owned by the harness**.

Jev must not become:

- the primary coding model;
- a second coding agent;
- a general chat model;
- a tool exposed directly to the main Pi model;
- an authority for security, source freshness, test validity, or recovery replay.

The intended role is:

> provide cheap, typed, probabilistic decisions for fuzzy workflow judgments while Marcus keeps deterministic control over safety and correctness.

Initial use cases:

1. failure triage;
2. semantic progress/no-progress judgment;
3. review-risk advisory.

Possible later use cases, only after benchmark evidence:

4. harness stage routing;
5. context reranking;
6. compaction keep/drop scoring.

---

# 2. Core architectural decision

Do **not** integrate Jev through the existing primary-model abstraction in `models.providers`.

Current primary-model abstraction represents coding/chat generation models:

```text
PiAgentKernel
    ↓
ModelRuntime
    ↓
OpenAI-compatible / OpenRouter / LiteLLM
    ↓
coding/chat model
```

Jev should instead use a separate decision abstraction:

```text
PiAgentKernel
     │
     ▼
AgentHarness / RunController
     │
     ├── deterministic rules
     │
     └── HarnessDecisionEngine
              │
              └── JevDecisionProvider
                       │
                       ├── OpenRouter transport
                       └── TypeSafe direct transport (later)
```

Jev output is typed advisory state, not generated coding output.

---

# 3. Non-goals

The implementation MUST NOT allow Jev to decide or override:

- whether a shell command is authorized;
- whether a source file may be read;
- whether a path contains secrets;
- whether a file write is allowed;
- whether test evidence is trusted;
- whether a JUnit/TRX report is valid;
- whether source content is fresh;
- whether a checkpoint restore is valid;
- whether an unknown external side effect should be replayed;
- whether a mutation lock may be bypassed;
- whether run duration/model-turn hard limits may be bypassed.

These remain deterministic Marcus responsibilities:

```text
PathPolicy
PolicyExecutor
trusted test baseline
source/content hashes
test parsers
SQLite transactions
checkpoint validation
Pi transcript correlation
worktree lock
AgentHarness hard limits
```

Jev may classify risk, but cannot grant authority.

---

# 4. Feature ownership

Jev must be owned by the harness/runtime layer.

Preferred ownership:

```text
src/
├── decision/
│   ├── engine.ts
│   ├── types.ts
│   ├── state-builder.ts
│   ├── policy.ts
│   ├── metrics.ts
│   └── providers/
│       ├── openrouter.ts
│       └── typesafe.ts        # optional/later
│
├── workflow/
│   └── harness.ts
│
└── agent/
    └── kernel.ts
```

The main Pi model must not receive a tool such as:

```text
ask_jev
query_jev
jev_decide
```

Do not register Jev inside `createMacusTools()`.

The harness decides deterministically when Jev is invoked.

---

# 5. Recommended interface

Create a provider-neutral decision interface.

Example:

```ts
export type DecisionKind =
  | "failure_triage"
  | "progress_judge"
  | "review_risk";

export interface DecisionRequest<TQuestions> {
  kind: DecisionKind;
  schemaVersion: number;
  state: unknown;
  questions: TQuestions;
}

export interface DecisionAnswer<T> {
  value: T;
  confidence?: number;
  probability?: number;
}

export interface DecisionResult<TAnswers> {
  model: string;
  provider: string;
  latencyMs: number;
  answers: TAnswers;
  stateDigest: string;
}

export interface HarnessDecisionEngine {
  evaluate<TQuestions, TAnswers>(
    request: DecisionRequest<TQuestions>,
    signal?: AbortSignal
  ): Promise<DecisionResult<TAnswers> | null>;
}
```

A provider failure should normally return `null` rather than fail the run.

---

# 6. Configuration design

Do not place Jev under the current primary `models` section.

Add a dedicated internal-model namespace.

Recommended schema:

```yaml
internal_models:
  jev:
    enabled: false

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

Recommended feature flag:

```yaml
features:
  jev_harness: false
```

Default:

```text
jev_harness = false
```

---

# 7. Configuration authority

This feature sends structured repository/runtime information to an external provider.

Therefore project configuration must not be able to enable it.

Required authority rule:

```text
Global/user config:
  may enable
  may disable
  defines endpoint/model/credential env

Project config:
  may disable
  MUST NOT enable
  MUST NOT change provider
  MUST NOT change API key env
  MUST NOT change endpoint
```

This is stricter than ordinary feature flags.

Suggested policy:

```text
effective_jev_enabled =
  global.features.jev_harness === true
  &&
  project.features.jev_harness !== false
```

But project config:

```yaml
features:
  jev_harness: true
```

must fail validation if the global setting is false.

Never expand credential values into project-visible state.

---

# 8. Provider strategy

## Phase 1 provider

Use OpenRouter first.

Reasons:

- already fits the user's existing provider workflow;
- centralized API key management;
- easier initial experimentation;
- simpler operational setup.

Use a dedicated decision transport rather than reusing the Pi chat runtime.

Preferred class:

```text
OpenRouterJevDecisionProvider
```

Do not assume the endpoint/request format is identical to normal OpenAI chat-completions.

Follow the current OpenRouter/System One decision API contract.

## Phase 2 provider

Add:

```text
TypeSafeDirectDecisionProvider
```

only if needed.

Harness code must not change when switching transport.

---

# 9. Model pinning

During development/shadow evaluation it is acceptable to test a moving Jev alias.

For any behavior-affecting deployment, pin the model version.

Preferred pattern:

```text
typesafe/jev-<version>
```

Reason:

Marcus may later depend on probability/confidence thresholds.

A moving model alias can change calibration without a code/config change.

Persist the exact returned/resolved model ID with every decision record.

---

# 10. Failure policy

Jev is optional infrastructure.

The default policy must be:

```text
SOFT FAIL
```

Flow:

```text
Harness event
   ↓
Jev call
   ↓
timeout / 429 / 5xx / parse error / unavailable
   ↓
record unavailable
   ↓
continue using deterministic Marcus behavior
```

Jev failure must not block a coding run.

Recommended timeout:

```yaml
timeout_ms: 1500
```

This value must be configurable and bounded.

No retries in the first implementation.

Reason:

retries can make a supposedly cheap decision path become a latency multiplier.

Later, one bounded retry may be considered only after metrics justify it.

---

# 11. Rollout modes

Implement three explicit modes.

## 11.1 Shadow

```yaml
mode: shadow
```

Behavior:

- call Jev;
- persist decision/metrics;
- DO NOT change harness behavior;
- DO NOT inject advisory into primary model context;
- compare against actual outcome later.

This is the mandatory initial mode.

## 11.2 Advisory

```yaml
mode: advisory
```

Behavior:

- call Jev;
- persist decision;
- allow harness to expose a compact advisory to the main coding model;
- advisory does not override deterministic gates.

Example:

```text
Internal Harness Advisory

Failure type: dependency/configuration
Confidence: 0.91
Repeated identical retry likely useful: no (0.08)
```

## 11.3 Limited routing

Future only.

```yaml
mode: limited-routing
```

Do not implement control authority in the first delivery.

A later release may permit Jev to influence only non-safety workflow transitions such as:

```text
fix → test
review → test
test → fix
```

Hard limits remain deterministic.

---

# 12. Initial decision use case — failure_triage

This should be the first implemented decision.

Trigger:

```text
run_test failed
or
run_command returned a stable non-zero failure
```

Do not send raw entire logs.

Build minimal structured state.

Example:

```json
{
  "stage": "test",
  "taskId": "T-014",
  "taskTitle": "Implement parser validation",
  "attempt": 2,
  "commandClass": "trusted_test",
  "exitCode": 1,
  "timedOut": false,
  "cancelled": false,
  "diagnosticSummary": "...bounded redacted summary...",
  "changedFiles": [
    "src/parser.ts",
    "tests/parser.test.ts"
  ],
  "previousFailureClass": "code_bug",
  "sourceChangedSincePreviousFailure": true
}
```

Questions:

```text
failure_type:
  choice:
    - code_bug
    - test_bug
    - dependency
    - environment
    - configuration
    - flaky
    - unknown

retry_same_strategy:
  yes/no

needs_source_change:
  yes/no

likely_external_issue:
  yes/no
```

Expected result is typed and probabilistic.

---

# 13. Initial decision use case — progress_judge

Purpose:

supplement the current deterministic no-progress fingerprint.

The current hard logic must remain.

Jev answers whether the last attempt represents meaningful semantic progress.

Input example:

```json
{
  "task": "Fix parser validation",
  "stage": "fix",
  "attempt": 3,
  "previousDiagnosticClass": "assertion_failure",
  "currentDiagnosticClass": "assertion_failure",
  "previousChangedFiles": ["src/parser.ts"],
  "currentChangedFiles": ["src/parser.ts", "tests/parser.test.ts"],
  "sourceChanged": true,
  "sameFailureFingerprint": true
}
```

Questions:

```text
meaningful_progress:
  yes/no

strategy_materially_changed:
  yes/no

likely_looping:
  yes/no
```

Important:

Jev must not reset hard run limits.

It may affect advisory/no-progress semantics only after shadow evaluation.

---

# 14. Initial decision use case — review_risk

Trigger:

```text
Harness enters review
```

Input should be a bounded summary derived from existing Marcus evidence:

```text
task status
linked evidence summary
test freshness
Git diff summary
changed-file count
risk flags
unresolved tasks
untrusted evidence count
stale evidence count
```

Do not send the entire diff by default.

Questions:

```text
implementation_matches_task:
  yes/no

regression_risk:
  choice:
    - negligible
    - low
    - medium
    - high
    - critical

evidence_sufficient:
  yes/no

needs_more_testing:
  yes/no

likely_scope_creep:
  yes/no
```

Output is advisory only.

Never convert:

```text
Jev says safe
```

into:

```text
review passes
```

Marcus deterministic review remains authoritative.

---

# 15. Confidence policy

Do not treat any probability threshold as calibrated initially.

For the PoC, classify confidence only for analysis.

Suggested display bands:

```text
< 0.70
  low confidence / ignore for behavior

0.70 – 0.85
  advisory

> 0.85
  strong advisory
```

These are provisional display thresholds, not automation thresholds.

Do not enable routing based on these numbers until Marcus-specific calibration data exists.

---

# 16. State minimization

Never send the complete Pi transcript to Jev.

Never send full repository context by default.

Preferred rule:

> Jev receives the smallest structured state sufficient to answer its decision questions.

Send:

- stage;
- task summary;
- bounded error summary;
- outcome counters;
- selected changed-file paths;
- evidence state;
- prior decision category when useful.

Avoid:

- source file bodies;
- entire diffs;
- raw execution logs;
- secrets;
- provider credentials;
- complete conversation history;
- entire repository maps.

If source content becomes necessary for a future use case, that must be separately designed and explicitly enabled.

---

# 17. Data safety

Before sending state externally:

1. run strings through existing credential redaction;
2. do not include environment values;
3. do not include denied-path content;
4. do not send execution log bodies unless separately sanitized;
5. limit diagnostic text length;
6. prefer file paths and hashes over file bodies;
7. persist state digest instead of raw state when possible.

Jev activation must be explicit at user/global configuration level.

---

# 18. Decision persistence

Add a durable record for every Jev call.

Suggested SQLite table:

```text
decision_events
```

Suggested columns:

```text
id
session_id
run_id
kind
provider
model
mode
schema_version
state_digest
request_metadata
response_payload
confidence_summary
latency_ms
status
created_at
```

Do not persist API keys.

Prefer not to persist raw source-derived state.

Store:

```text
state_digest
questions schema/version
typed answers
model ID
latency
status
```

Raw request persistence should be opt-in/debug-only and must be redacted.

---

# 19. Metrics

Track at minimum:

```text
calls
success
timeout
429
provider_error
parse_error

latency p50/p95

input tokens or provider-reported usage
estimated cost

decision kind

confidence distribution

shadow agreement with eventual outcome
```

For evaluation, also calculate:

```text
main-model turns saved
wall-clock saved
false-high-confidence rate
```

The main success criterion is not simply Jev accuracy.

The important question is:

> Does Jev reduce expensive primary-model reasoning while preserving or improving run quality?

---

# 20. Harness integration

Current harness owns:

```text
stage
modelTurns
max duration
no-progress counter
last failure fingerprint
hard blocking
```

Extend it via dependency injection.

Target shape:

```ts
class AgentHarness {
  constructor(
    limits: HarnessLimits,
    private readonly decisions?: HarnessDecisionEngine
  ) {}
}
```

Do not embed HTTP logic inside `AgentHarness`.

Prefer a higher-level coordinator if the harness API begins becoming asynchronous.

Possible shape:

```text
HarnessCoordinator
├── AgentHarness          # deterministic state
└── HarnessDecisionEngine # optional fuzzy decisions
```

This may be cleaner because current harness methods are synchronous.

---

# 21. Important async-design consideration

The current `AgentHarness` methods such as:

```text
onTurn()
onFailure()
onProgress()
advance()
check()
```

are synchronous.

Do not casually convert every harness state transition to async.

Recommended first implementation:

```text
Tool result event
    ↓
deterministic AgentHarness update
    ↓
HarnessDecisionCoordinator.observe(...)
    ↓
async Jev call
    ↓
persist shadow decision
```

In shadow mode the Jev request does not need to sit inside the synchronous state-transition path.

For advisory mode, wait only at deliberately selected boundaries:

- after a test failure;
- before review completion advisory;
- after repeated failure/no-progress events.

Avoid calling Jev on every tool result.

---

# 22. Suggested event API

Create internal decision events:

```ts
type HarnessDecisionEvent =
  | {
      type: "test_failed";
      ...
    }
  | {
      type: "repeated_failure";
      ...
    }
  | {
      type: "review_requested";
      ...
    };
```

Coordinator:

```ts
interface HarnessDecisionCoordinator {
  observe(
    event: HarnessDecisionEvent,
    signal?: AbortSignal
  ): Promise<void>;
}
```

Shadow mode:

```text
observe()
  ↓
async evaluate
  ↓
persist
  ↓
no runtime behavior change
```

---

# 23. Do not expose Jev as an agent tool

Explicit non-goal:

Do not add any of the following to `src/agent/tools.ts`:

```text
ask_jev
jev_score
jev_decide
decision_model
```

Reason:

The main model should not decide whether the internal control-plane model is invoked.

The harness/runtime owns invocation policy.

This preserves separation between:

```text
agent behavior
and
runtime supervision
```

---

# 24. Suggested new types

Extend `src/types.ts` carefully.

Recommended:

```ts
export interface JevInternalModelConfig {
  enabled: boolean;
  transport: "openrouter" | "typesafe";
  model: string;
  api_key_env: string;
  timeout_ms: number;
  max_state_tokens: number;
  mode: "shadow" | "advisory" | "limited-routing";
  decisions: {
    failure_triage: boolean;
    progress_judge: boolean;
    review_risk: boolean;
    stage_router: boolean;
    context_rerank: boolean;
    compaction_filter: boolean;
  };
}
```

Add to `MacusConfig` under:

```text
internal_models
```

Do not overload `ProviderConfig`.

---

# 25. Feature flag

Add:

```text
features.jev_harness
```

Recommended default:

```text
false
```

This differs from current complete-V1 feature defaults because external decision routing is experimental and must be opt-in.

Update:

- `FeatureFlags`;
- default config;
- config validation;
- example config;
- runbook;
- capability reporting.

Important:

project config must not elevate this flag from false to true.

---

# 26. API key handling

Recommended:

```yaml
internal_models:
  jev:
    api_key_env: OPENROUTER_API_KEY
```

Never store literal API keys.

Ensure the Jev credential env name is added to the same secret-stripping policy used for main model provider credentials.

The credential must not be forwarded to shell subprocesses.

---

# 27. Request limits

Initial hard limits:

```text
timeout_ms <= 5000
recommended default = 1500

max_state_tokens <= 16000
recommended default = 8000

max diagnostic text per event
recommended <= 4000 chars

max changed file paths
recommended <= 50
```

Keep the decision state substantially below Jev context capacity.

A decision call should stay cheap and bounded.

---

# 28. Cancellation

Propagate the current run `AbortSignal` into Jev calls.

When:

- user aborts;
- run duration expires;
- session is disposed;

outstanding Jev network requests should abort.

An aborted Jev call must not outlive the run and later mutate current harness state.

Use run ID / event ID correlation before applying any advisory result.

---

# 29. Stale decision protection

A delayed Jev response must not apply to a later state.

Every decision request should carry:

```text
sessionId
runId
eventId
stateDigest
```

Before applying advisory output, verify:

```text
current runId == request runId
and
relevant state digest still matches
```

If not:

```text
record status = stale
ignore result
```

---

# 30. Shadow-mode evaluation dataset

Collect real Marcus events.

Initial target:

```text
failure_triage   >= 100 events
progress_judge   >= 100 events
review_risk      >= 100 events
```

Ground truth can derive from:

- eventual successful fix;
- trusted test evidence;
- actual next successful action;
- deterministic review output;
- human acceptance/rejection where available.

Do not use model self-agreement as the only ground truth.

---

# 31. Benchmark metrics

For each decision kind measure:

```text
accuracy
precision
recall
F1 where meaningful

confidence calibration
false-high-confidence rate

latency p50
latency p95

provider failure rate
timeout rate

average state size
input tokens
cost / event
cost / run

primary-model turns saved
wall-clock saved
```

Most important operational metrics:

```text
false-high-confidence rate
primary-model turns saved
wall-clock impact
```

---

# 32. Promotion criteria

Do not move from shadow to advisory until:

- no safety authority has leaked into Jev;
- provider failures remain soft-fail;
- false-high-confidence cases are understood;
- state sanitization is verified;
- latency is acceptable;
- decision records are durable;
- benchmark dataset is large enough to evaluate usefulness.

Do not move from advisory to limited routing until:

- Marcus-specific confidence calibration exists;
- routing improves wall-clock or model-turn count;
- regression runs show no reduction in completion quality;
- routing cannot bypass deterministic hard limits.

---

# 33. Phase J1 — Decision foundation

Implement:

```text
JEV-001 DecisionEngine abstraction
JEV-002 Jev config/types
JEV-003 global-only enablement policy
JEV-004 OpenRouter decision transport
JEV-005 decision event persistence
JEV-006 redaction/state minimization
JEV-007 timeout/cancellation
JEV-008 shadow metrics
```

No runtime behavior changes in this phase.

### J1 acceptance criteria

- feature defaults OFF;
- disabled state performs zero Jev network calls;
- project config cannot enable Jev;
- API key comes only from configured env;
- provider failure cannot fail a Marcus run;
- response is schema validated;
- exact model/version is persisted;
- raw credentials are never logged;
- stale response cannot affect another run;
- shadow decisions are queryable for benchmark analysis.

---

# 34. Phase J2 — Initial decisions

Implement:

```text
JEV-101 failure_triage
JEV-102 progress_judge
JEV-103 review_risk
```

Still default to shadow mode.

Add state builders specific to each decision.

Do not create one generic “send arbitrary Marcus state” API.

Every decision kind should define:

- exact state schema;
- exact question schema;
- state-size limit;
- allowed fields;
- redaction rules;
- version number.

---

# 35. Phase J3 — Advisory

After successful benchmark:

```text
mode = advisory
```

Allow compact Jev decisions to appear as internal harness advisory.

Possible destinations:

- structured event visible to primary model;
- /review advisory section;
- local metrics/report.

Do not inject verbose Jev payloads into the context.

Example:

```text
Harness advisory:
  failure_type=dependency
  confidence=0.91
  retry_same_strategy=false
```

---

# 36. Phase J4 — Future experimental routing

Not part of first implementation.

Potential experiments:

```text
stage_router
context_rerank
compaction_filter
```

These require separate benchmarks.

Do not bundle them into J1/J2.

---

# 37. Context reranking — later design only

Potential future flow:

```text
Marcus deterministic candidate selection
            ↓
top bounded candidates
            ↓
Jev relevance scoring
            ↓
combined score
            ↓
existing token budget selector
```

Example:

```text
final_score =
  0.65 * deterministic_score
+ 0.35 * jev_relevance_probability
```

Do not let Jev resurrect:

- stale fragments;
- denied files;
- fragments outside PathPolicy;
- fragments already rejected by hard budget/safety policy.

Jev can only rerank candidates already eligible under deterministic rules.

---

# 38. Compaction filtering — later design only

Jev may eventually score:

```text
retain decision
retain blocker
retain source reference
retain historical failure
```

But durable Marcus requirements remain authoritative.

Never allow Jev to discard:

- unresolved blocker;
- active task;
- unknown execution;
- current goal;
- required checkpoint/recovery state.

---

# 39. Review-risk integration

If advisory mode is promoted, extend review with a separate section.

Example:

```text
AI Risk Advisory

Regression risk       medium   confidence 0.87
Evidence sufficient   no       probability 0.82
Scope creep           no       probability 0.94
```

Keep existing:

```text
RemainingRisk
TaskEvidence
Tested
Changed
UnresolvedIssue
```

unchanged and authoritative.

---

# 40. Logging and observability

Add local counters, preferably to the existing local metrics approach.

Do not introduce an external telemetry system.

Recommended metrics:

```text
jev.calls
jev.success
jev.timeout
jev.provider_error
jev.parse_error
jev.stale_result

jev.latency_ms

jev.state_estimated_tokens

jev.failure_triage.calls
jev.progress_judge.calls
jev.review_risk.calls
```

Later add:

```text
jev.shadow.correct
jev.shadow.incorrect
jev.high_confidence_error
```

---

# 41. Suggested CLI/operator visibility

Add read-only visibility only after J1.

Possible command:

```text
/status
```

include:

```text
Jev Harness   shadow / typesafe/jev-1.13
Last decision failure_triage / 0.91 / 142 ms
```

Optional future:

```text
/decision status
/decision metrics
```

Do not add a CLI command that asks Jev arbitrary questions.

---

# 42. Security invariants

Tests must prove all of these:

1. project config cannot enable Jev when global config disables it;
2. Jev API key is absent from child process environment;
3. denied-path contents cannot enter decision state;
4. feature disabled means zero HTTP calls;
5. provider timeout does not fail the run;
6. malformed response does not fail the run;
7. stale delayed response cannot affect a newer run;
8. Jev cannot authorize shell/edit operations;
9. Jev cannot mark test evidence passed;
10. Jev cannot trigger recovery replay;
11. Jev cannot bypass context/source freshness;
12. Jev is not registered as a Pi tool.

---

# 43. Suggested tests

Add:

```text
tests/jev-config.test.ts
tests/jev-global-authority.test.ts
tests/jev-disabled.test.ts
tests/jev-openrouter-transport.test.ts
tests/jev-timeout.test.ts
tests/jev-malformed-response.test.ts
tests/jev-redaction.test.ts
tests/jev-stale-response.test.ts
tests/jev-failure-triage.test.ts
tests/jev-progress-judge.test.ts
tests/jev-review-risk.test.ts
tests/jev-shadow-no-control.test.ts
tests/jev-no-agent-tool.test.ts
tests/jev-credential-isolation.test.ts
```

Use mock HTTP servers for transport tests.

Do not require live OpenRouter/TypeSafe access in the normal unit suite.

---

# 44. Live validation

Keep live-provider validation separate from the normal suite.

Suggested environment:

```bash
export OPENROUTER_API_KEY=...
export MACUS_JEV_LIVE_TEST=1
```

Suggested command:

```bash
npm run test:jev-live
```

The live test should:

1. send a small deterministic typed decision;
2. validate response schema;
3. record model/version;
4. report latency;
5. avoid repository source content;
6. skip safely when credentials are absent.

Live tests must never be required for `npm test`.

---

# 45. Example global configuration

Future example:

```yaml
schema_version: 1

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

Project config may explicitly disable it:

```yaml
features:
  jev_harness: false
```

Project config may not enable or reconfigure it.

---

# 46. Implementation order

Recommended exact sequence:

```text
1. Add Jev config/types with default OFF
2. Add global/project authority validation
3. Add DecisionEngine interface
4. Add durable decision event storage
5. Add OpenRouter transport
6. Add response/schema validation
7. Add timeout + AbortSignal propagation
8. Add state redaction/minimization
9. Add HarnessDecisionCoordinator
10. Wire shadow failure_triage
11. Wire shadow progress_judge
12. Wire shadow review_risk
13. Add metrics
14. Add mock-provider integration tests
15. Add optional live-provider test
16. Run shadow benchmark
17. Write calibration report
18. Decide whether to promote to advisory
```

Do not start context reranking or stage routing before step 18.

---

# 47. Files expected to change

Likely existing files:

```text
src/types.ts
src/config.ts
src/capabilities.ts
src/workflow/harness.ts
src/agent/kernel.ts
src/storage/state.ts
docs/config.example.yaml
runbook.md
improvement.md
```

Likely new files:

```text
src/decision/types.ts
src/decision/engine.ts
src/decision/state-builder.ts
src/decision/policy.ts
src/decision/metrics.ts
src/decision/providers/openrouter.ts
src/storage/decision-events.ts    # or StateStore domain API

tests/jev-*.test.ts
docs/jev-benchmark.md
docs/jev-calibration.md
```

Avoid modifying `src/agent/tools.ts` except if shared event metadata is genuinely required.

Jev must not become a registered agent tool.

---

# 48. Interaction with Phase 8 improvements

The current `improvement.md` proposes:

- RunController;
- PiAgentKernel decomposition;
- storage repository APIs;
- CLI command registry;
- local runtime metrics.

Jev integration should align with that direction rather than deepen current coupling.

Preferred dependency direction:

```text
RunController / HarnessCoordinator
             ↓
HarnessDecisionEngine
             ↓
Jev provider
```

Avoid:

```text
PiAgentKernel
  └── direct fetch(OpenRouter/Jev)
```

If Phase 8 refactoring starts first, add Jev after RunController/HarnessCoordinator exists.

If Jev PoC starts first, keep it isolated enough to move later without behavioral changes.

---

# 49. Acceptance gate for the PoC

The PoC is complete when:

- Jev is optional and OFF by default;
- project configuration cannot turn it on;
- OpenRouter decision transport works against a mock server;
- live test can be run manually with a real credential;
- Jev is not visible as a Pi tool;
- failure_triage, progress_judge, and review_risk schemas exist;
- all three run in shadow mode;
- provider errors/timeout are soft failures;
- credential and source redaction tests pass;
- decision events are durable and queryable;
- no Jev result changes current Marcus behavior in shadow mode;
- normal Marcus regression suite remains green;
- benchmark report can compare Jev predictions with eventual outcomes.

---

# 50. Go / No-Go criteria after shadow evaluation

## Promote to advisory if

- false-high-confidence rate is acceptable;
- decisions correlate meaningfully with real outcomes;
- p95 latency is acceptable;
- external failure rate is low enough;
- decision calls remain cheap;
- main-model turns can plausibly be reduced;
- no safety boundary depends on Jev;
- operator finds advisories useful.

## Do not promote if

- Jev frequently produces high-confidence wrong classifications;
- latency materially slows runs;
- decision state requires sending excessive source content;
- advisories duplicate what deterministic Marcus already knows;
- provider availability is poor;
- integration complexity exceeds the model-turn savings.

---

# 51. Final design recommendation

Implement Jev as:

```text
optional
global-only enabled
default OFF
version-pinned
soft-fail
typed
bounded
state-minimized
persisted
observable
shadow-first
harness-owned
```

Do not implement it as:

```text
second coding agent
chat model replacement
Pi-visible tool
security judge
test authority
recovery authority
unbounded context consumer
mandatory runtime dependency
```

The intended Marcus architecture is:

```text
Primary Coding Model
        │
        ▼
PiAgentKernel
        │
        ▼
Marcus Runtime / Harness
        │
        ├── Deterministic Safety & Correctness
        │
        │     ├── PathPolicy
        │     ├── ExecutionPolicy
        │     ├── source hashes
        │     ├── trusted evidence
        │     ├── checkpoint/recovery
        │     └── hard run limits
        │
        └── Optional Jev Decision Engine
              ├── failure triage
              ├── progress judge
              └── review risk
```

Jev should function as a **fuzzy decision primitive inside the harness**, not as another autonomous agent.

That boundary should remain the central implementation constraint.

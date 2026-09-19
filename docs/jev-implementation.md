# Jev Harness Implementation

Date: 2026-09-19
Status: J1 foundation + J2 shadow decisions implemented
Behavioral promotion: not enabled

## Implemented

- dedicated internal Jev config namespace;
- feature default OFF;
- project config cannot enable or reconfigure Jev;
- OpenRouter Decisions transport;
- TypeSafe direct transport endpoint support behind the same adapter;
- typed Choice / Score / Noul request and response validation;
- soft-fail timeout/provider/parse/cancellation handling;
- bounded and redacted decision state;
- run/event correlation and stale-response rejection;
- durable decision_events storage;
- local decision metrics;
- failure_triage shadow decision;
- progress_judge shadow decision;
- review_risk shadow decision;
- run-scoped AbortSignal propagation;
- Jev API-key stripping from shell subprocess environment;
- no Pi-visible Jev tool;
- /status Jev visibility;
- /decisions read-only inspection;
- optional live OpenRouter test;
- benchmark and calibration documents.

## Runtime authority

Jev is shadow-only. It cannot change:

- harness stage;
- authorization;
- mutation locks;
- test evidence;
- source freshness;
- checkpoint/recovery decisions;
- hard run limits;
- Pi tool selection.

Configuration validation currently rejects advisory and limited-routing modes.

## OpenRouter transport

Default model:

```text
typesafe/jev-1.13
```

Default endpoint:

```text
POST https://openrouter.ai/api/alpha/decisions
```

Request shape:

```json
{
  "model": "typesafe/jev-1.13",
  "state": {},
  "questions": {}
}
```

Jev is not sent through chat/completions.

## TypeSafe direct transport

Supported endpoint default:

```text
POST https://api.typesafe.ai/v1/systemone
```

The direct transport uses the same internal provider abstraction. Current automated tests use mock HTTP only; direct live provider validation remains external.

## Data minimization

Raw decision state is not persisted.

Durable event records contain:

- state digest;
- question IDs/types;
- estimated state tokens;
- typed answers;
- resolved model/provider;
- usage;
- confidence summary;
- latency;
- status.

Review-risk state does not include the Git diff body; only bounded metadata is sent.

## Failure behavior

The following all return control to Marcus without failing the coding run:

- Jev disabled;
- oversized state;
- timeout;
- provider failure;
- malformed response;
- cancellation;
- stale delayed response.

## Tests

Current normal regression result:

```text
117 passed
1 live-only test skipped
61 total test files
69 passed files
1 skipped live-only file
```

The live test is intentionally excluded unless:

```bash
export OPENROUTER_API_KEY=...
npm run test:jev-live
```

## Promotion gate

Remain in shadow mode until the workload-specific benchmark and calibration in these files are complete:

```text
docs/jev-benchmark.md
docs/jev-calibration.md
```

Advisory and limited-routing are deliberately not implemented as active behavior yet.

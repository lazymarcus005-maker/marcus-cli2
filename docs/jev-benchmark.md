# Jev Shadow Benchmark

Status: ready to collect shadow data.

## Scope

Evaluate three Marcus harness decisions without allowing Jev to change runtime behavior:

- failure_triage
- progress_judge
- review_risk

## Minimum evaluation set

Target at least:

- 100 failure-triage events;
- 100 progress-judge events;
- 100 review-risk events.

Ground truth should come from eventual successful fixes, trusted test evidence, deterministic review state, actual next successful actions, and human acceptance/rejection where available.

Do not use model self-agreement as the sole ground truth.

## Metrics

Measure:

- accuracy / precision / recall where applicable;
- confidence calibration;
- false-high-confidence rate;
- latency p50 / p95;
- timeout/provider/parse-error rate;
- average estimated state size;
- provider-reported input tokens and cost;
- potential primary-model turns saved;
- wall-clock impact.

The primary operational question is:

> Does Jev remove expensive primary-model reasoning turns without reducing completion quality?

## Data source

Use durable rows from the local `decision_events` table. Raw source state is not persisted by default; use state digests, typed answers, usage, latency, run IDs, and eventual Marcus outcomes.

## Promotion rule

Remain in shadow mode until calibration evidence is sufficient. Advisory and limited-routing modes are intentionally rejected by configuration validation in the current implementation.

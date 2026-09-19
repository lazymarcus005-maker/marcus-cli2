# Jev Calibration Status

Current status: **NOT CALIBRATED — SHADOW ONLY**

Model default: `typesafe/jev-1.13` through OpenRouter Decisions API.

Marcus currently records Jev decisions but does not use them to:

- authorize tools;
- change test evidence;
- change source freshness;
- replay recovery effects;
- change hard run limits;
- alter harness stages;
- inject advisory into the primary model.

Provisional confidence bands from the design handoff are for analysis only:

- below 0.70: low confidence;
- 0.70–0.85: advisory candidate;
- above 0.85: strong advisory candidate.

These are **not automation thresholds**.

Before advisory promotion, produce workload-specific calibration results for failure triage, progress judgment, and review risk. Pay particular attention to false-high-confidence decisions.

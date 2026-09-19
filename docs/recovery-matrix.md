# Recovery and Safety Matrix

Validated on macOS arm64. Target runtime is Node 22.19.0 unless a test is explicitly environment-independent.

| Boundary / scenario | Expected behavior | Evidence | Status |
| --- | --- | --- | --- |
| Prepared execution before launch | Keep intent; never replay automatically | tests/recovery.test.ts | Pass |
| File side effect before durable completion | Compare current file with before/expected-after hashes; reconcile without replay when after-hash matches | tests/reconcile.test.ts | Pass |
| File differs from known before/after | Preserve conflict/unknown state; no replay | tests/reconcile.test.ts | Pass |
| External source changes between read and final write commit | Re-hash immediately before rename; refuse overwrite | tests/toctou-write.test.ts | Pass |
| Shell/external effect uncertain | Mark unknown_external_effect and replayAllowed=false | tests/reconcile.test.ts | Pass |
| Second Macus mutator in same worktree | Reject second OS-backed lock | tests/recovery.test.ts | Pass |
| Resume durable session | Acquire mutation lock before reconciliation and continue Pi transcript | src/cli.ts + tests/session-resume-integration.test.ts | Pass |
| Timeout process exits on TERM | Terminate group and report timedOut | tests/timeout.test.ts | Pass |
| Timeout process ignores TERM | TERM -> bounded grace -> SIGKILL while awaiting exit | tests/security-regressions.test.ts | Pass |
| Model requests timeout above user ceiling | Clamp to configured user limit | tests/timeout-clamp.test.ts | Pass |
| Cancellation during Pi manual compaction | Abort in-flight provider request; checkpoint/ledger were durable first | tests/compaction-cancel.test.ts | Pass |
| Provider turn exceeds run limit | Abort before HTTP request; durable run becomes blocked | tests/harness-runtime.test.ts | Pass |
| Provider request exceeds context budget | Abort before HTTP request | tests/budget-gate-integration.test.ts | Pass |
| Fresh schema migration interrupted after metadata creation | Roll back transaction completely | tests/migration.test.ts | Pass |
| Future state schema encountered | Reject before writing current-version tables | tests/migration.test.ts | Pass |
| Checkpoint temp/orphan/missing file | Remove incomplete temp, report orphan final, invalidate missing committed record | tests/recovery-edge.test.ts | Pass |
| Checkpoint write before compaction | fsync temp then atomic rename; cancel compaction on checkpoint failure | src/storage/checkpoint.ts + tests/compaction-cancel.test.ts | Pass |
| Expired/missing log | Explicit expired-or-missing error | tests/recovery-edge.test.ts | Pass |
| Provider credential requested by subprocess env | Strip trusted provider credential variables and redact persisted/output copies | tests/security-regressions.test.ts | Pass |
| Secret repository file not in gitignore | Search/read/index deny by central PathPolicy | tests/security-regressions.test.ts | Pass |
| Branch change in Git worktree | Keep worktree identity stable while reporting branch change | tests/git-context.test.ts | Pass |
| Git dirty diff evidence | Bounded Git diff appears in review | tests/review-freshness.test.ts | Pass |
| Green test evidence followed by source edit | Review marks evidence stale | tests/review-freshness.test.ts | Pass |
| Search pagination after repository edit | Reject stale cursor generation | tests/cursor-generation.test.ts | Pass |
| Graph source file changes/deletes | Replace file-origin edges and prune dangling symbol edges | tests/graph-invalidation.test.ts | Pass |
| Provider/network stalls past max_duration_seconds | Abort active Pi session and finalize durable run as blocked | tests/run-duration.test.ts | Pass |
| Ledger persistence fails after model work | Propagate ledger failure but still finalize durable run; never leave running row | tests/run-finalization.test.ts | Pass |
| Resume with durable working files | Re-resolve through PathPolicy and restore only hash-fresh files | tests/resume-ledger.test.ts | Pass |
| AbortSignal already aborted before shell/search launch | Do not launch work; return durable cancellation/partial result | tests/preaborted-cancellation.test.ts | Pass |
| Tracked .macus/internal content in Git history/worktree | Exclude internal/secret paths from diff/show surfaces | tests/git-policy.test.ts | Pass |
| Bounded repo discovery is truncated | Never reconcile deletion from a partial discovery set | tests/repo-map-truncation.test.ts | Pass |
| Multi-suite JUnit contains later failure | Aggregate full report; failure prevents passed evidence | tests/report-parsers.test.ts | Pass |
| Repeated identical failing shell attempts | Stable failure fingerprint reaches no-progress block without extra provider request | tests/no-progress-runtime.test.ts | Pass |
| Undiscovered command emits a green JUnit/TRX report | Run may execute, but evidence remains unknown rather than passed | tests/test-evidence-trust.test.ts | Pass |
| Structured report points outside workspace or to denied internal path | Reject through PathPolicy before evidence parsing | tests/test-evidence-trust.test.ts | Pass |
| Pre-existing structured report is unchanged by current run | Mark report stale/partial; never reuse it as passing evidence | tests/test-evidence-trust.test.ts | Pass |
| Structured report exceeds bounded parser size | Do not load/parse into pass; return unknown/partial evidence | tests/test-evidence-trust.test.ts | Pass |
| Git HEAD changes after green test while source bytes remain equal | Review invalidates evidence through HEAD/repository identity binding | tests/evidence-identity-task.test.ts | Pass |
| Completed task has no linked fresh passing evidence | Review reports task-specific remaining risk | tests/evidence-identity-task.test.ts | Pass |
| Historical search source becomes stale after edit | Omit stale search result before provider dispatch and record omission | tests/context-search-freshness.test.ts | Pass |
| Provider request contains fresh search source | Manifest classifies it as search_results and records included fragments | tests/context-search-freshness.test.ts | Pass |
| Pi tool causes shell/edit side effect | Journal retains durable runId and Pi toolCallId | tests/execution-correlation.test.ts | Pass |
| Git change exists only in index | Bounded review diff includes staged section | tests/git-staged-unborn.test.ts | Pass |
| Git repository has no first commit | Report isGit=true with undefined HEAD | tests/git-staged-unborn.test.ts | Pass |
| Select checkpoint after source diverged | Restore task/ledger state, mark file stale, never roll back source bytes | tests/checkpoint-restore.test.ts | Pass |
| Agent records implementation decision | Persist decision text plus provenance in durable ledger | tests/checkpoint-restore.test.ts | Pass |
| Agent changes package.json/project trust source after session start | Baseline command is downgraded to untrusted/unknown until a new user-created session | tests/test-evidence-trust.test.ts | Pass |
| Structured report path is a symlink outside workspace | Reject before command/report evidence can be trusted | tests/test-evidence-trust.test.ts | Pass |
| Search line changes between ripgrep match and hash attachment | Drop raced match; never pair old text with a newer hash | tests/source-snapshot-race.test.ts | Pass |
| Same-size content changes while mtime is restored | Content-derived generation invalidates search cursor | tests/cursor-generation.test.ts | Pass |
| JUnit/TRX aggregate counters are internally inconsistent | Parser fails closed; evidence cannot become passed | tests/report-parsers.test.ts | Pass |
| Checkpoint contains multiple active tasks or future/corrupt schema | Reject before mutation; mark corrupt committed record incomplete | tests/checkpoint-validation.test.ts | Pass |
| Checkpoint task restore fails mid-transaction | Roll back all task/ledger mutations | tests/checkpoint-restore.test.ts | Pass |
| Checkpoint selects an earlier Pi transcript entry | Navigate AgentSession tree to checkpoint leaf before next prompt | tests/checkpoint-transcript.test.ts | Pass |
| Unknown shell execution has matching Pi terminal tool result | Finalize execution from transcript without replay | tests/recovery-transcript.test.ts | Pass |
| Journal tool_call_id is absent from selected transcript branch | Preserve unknown state and surface correlation_conflict | tests/recovery-transcript.test.ts | Pass |
| Ledger receives excessive decisions/files/blockers/free text | Normalize to bounded retained state | tests/ledger-bounds.test.ts | Pass |
| Jev feature disabled | Create no decision engine and perform zero Jev network calls | tests/jev-engine.test.ts | Pass |
| Project config attempts to enable/reconfigure Jev | Reject elevation; only trusted global/user config may enable external decision routing | tests/jev-config.test.ts | Pass |
| Jev API key appears in allowed subprocess env list | Strip the credential before shell launch | tests/jev-security.test.ts | Pass |
| Jev state contains configured secret values | Redact before network dispatch and persist only state digest/metadata | tests/jev-engine.test.ts | Pass |
| Jev decision state exceeds configured bound | Skip network call and persist skipped_oversize | tests/jev-state-bounds.test.ts | Pass |
| Jev provider times out or returns malformed response | Soft-fail decision path; coding run continues | tests/jev-engine.test.ts | Pass |
| Jev response arrives after active run changes | Mark decision stale and do not apply it | tests/jev-engine.test.ts | Pass |
| Jev enabled in shadow mode during command failure | Persist failure_triage decision without changing run outcome | tests/jev-kernel-shadow.test.ts | Pass |
| Main Pi tool registry with Jev enabled | Jev remains internal and is not exposed as an agent tool | tests/jev-security.test.ts | Pass |

No scenario in this matrix authorizes automatic replay of unknown side effects or automatic source rollback.

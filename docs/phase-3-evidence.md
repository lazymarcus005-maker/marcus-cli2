# Phase 3 Evidence — Context Runtime

Status: **implemented and locally validated**.

Implemented:
- session working-set/tier data structures and deterministic selector;
- source fragment provenance;
- actual provider request manifests persisted per session;
- exact top-level category sum against estimated payload bytes;
- fresh source hash tracking;
- duplicate read suppression;
- superseded source replacement while retaining tool-result protocol messages;
- /context and /context files inspection;
- model/profile capacity validation and trusted model switching.

Key integration evidence:
- tests/context-runtime-integration.test.ts proves a source read, later source write, and next provider request omit the superseded source body while keeping the tool-result message.
- tests/pi-adapter.test.ts proves the guard runs across nested provider requests.
- tests/context.test.ts covers deterministic dedup/freshness selection.

Provider-reported token usage is only shown when available; conservative byte estimation remains explicitly labelled.

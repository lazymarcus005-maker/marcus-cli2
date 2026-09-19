# Phase 6 Evidence — Lightweight Relationships

Status: **implemented as optional, conservative graph**.

Implemented:
- graph edges in rebuildable index.db;
- confirmed containment edges;
- candidate unique-name identifier references;
- unresolved ambiguous-name references;
- evidence, resolver version, confidence and index generation;
- find_references, find_dependencies, find_dependents and impact;
- all relationship outputs report partial coverage unless proven otherwise;
- disabled graph leaves search/read/workflow available.

Validation:
- tests/graph-workflow.test.ts verifies candidate relationships remain candidate and coverage remains partial.

The implementation deliberately does not claim compiler-grade cross-file semantic resolution.

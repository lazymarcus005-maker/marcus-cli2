# Phase 2 Evidence — Code Retrieval & Freshness

Status: **implemented and locally validated**.

Implemented:
- bounded structured-argv ripgrep search with literal default, explicit regex mode, timeout, global result cap and generation-bound cursor;
- .gitignore/.macusignore and mandatory directory exclusions;
- Tree-sitter TS/TSX, JS/JSX and C# syntactic symbols;
- disambiguated symbol IDs and parse coverage metadata;
- content-hash freshness checks;
- persistent rebuildable index.db;
- smart line-range reads with expected hash;
- bounded repository map.

Validation:
- tests/retrieval.test.ts
- tests/search-bound.test.ts
- external-write hash conflict in tests/policy.test.ts

Current workspace is non-Git, so branch-checkout invalidation is implemented through fresh source hashes/repository checks but a real checkout fixture is not part of the local evidence set.

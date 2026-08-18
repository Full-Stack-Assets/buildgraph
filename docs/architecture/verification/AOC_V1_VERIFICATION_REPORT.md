---
status: TESTED
version: 1.0.0
scope: AOC Canonical Architecture v1 implementation
verification_id: VER-001
date: 2026-08-18
---

# AOC Canonical Architecture v1 Verification Report

## Result

The implementation passed the BuildGraph automated conformance suite.

| Check | Result | Evidence |
|---|---|---|
| Automated tests | PASS | 17 test files; 48 tests passed |
| Strict JSON Schema compilation | PASS | All schemas registered under strict AJV 2020 mode |
| Registry validation | PASS | 94 manifests after verification-report closure |
| TypeScript typecheck | PASS | Zero errors |
| ESLint | PASS | Zero warnings and zero errors |
| Relationship compatibility | PASS | Zero invalid source/relationship/target triples |
| Deterministic graph validation | PASS | 94 entities, 360 relationships, zero errors, zero warnings |
| Preflight | PASS | EXTEND_EXISTING for project:buildgraph-core with payload and graph evidence |
| Reconciliation integrity | PASS | 198 classified records; source-document duplicate checksums verified |

## Scope

The suite covers:

- the canonical specification and ADR;
- one Organization and exactly ten permanent Division manifests;
- the 24-type ontology and v1 compatibility aliases;
- all requested first-class entity schemas;
- controlled relationship vocabulary and compatibility enforcement;
- 13 capability manifests;
- nine runtime profiles and Runtime Adapter Contract fields;
- library reconciliation counts and matrix presence;
- deterministic offline preflight;
- registry reference closure;
- graph compilation and content hashing;
- artifact and evidence checksum integrity;
- existing adapters, envelopes, router behavior, and ClickUp integration regression tests.

## Evidence state

This implementation is marked `TESTED`, not `VERIFIED`.

`TESTED` is justified by repeatable automated conformance evidence. `VERIFIED` requires an independent reviewer to accept the architecture, inspect the reconciliation judgments, and confirm deployment-specific capability claims.

Runtime-to-capability support remains `DECLARED` unless a capability record cites representative runtime execution evidence.

## Reproduction

Run from the repository root:

```bash
./node_modules/.bin/vitest run
./node_modules/.bin/tsc --noEmit -p tsconfig.json --pretty false
./node_modules/.bin/eslint . --max-warnings=0
node --import tsx scripts/validate-registry.ts
node --import tsx scripts/generate-graph.ts
node --import tsx scripts/preflight.ts --file docs/architecture/preflight/AOC_CANONICAL_ARCHITECTURE_REQUEST.json
```

The generated graph and validation report under `generated/buildgraph/` are the authoritative final content-hash evidence.

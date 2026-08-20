# BuildGraph

BuildGraph is a declarative control plane for governed, runtime-independent agentic work.

It stores versioned organization, division, product, project, capability, role, skill, agent, workflow, factory, work-order, runtime, tool, policy, evidence, artifact, verification, and decision manifests. Runtime adapters compile approved task-scoped definitions into bounded execution projections and normalize receipts back into a common evidence graph.

## AOC canonical architecture v1

The [Agent Operating Company Canonical Architecture](docs/architecture/AGENT_OPERATING_COMPANY_CANONICAL_ARCHITECTURE.md) is the constitutional extension of BuildGraph Core. It establishes exactly ten permanent divisions, capability-centered routing, definition/deployment separation, orthogonal autonomy and integration ceilings, controlled relationships, runtime portability, evidence states, offline-first preflight, and versioned architecture change control.

The deterministic local graph is the authoritative preflight engine. A live service may transport the same contract but is not required:

```bash
npm run preflight -- --file docs/architecture/preflight/AOC_CANONICAL_ARCHITECTURE_REQUEST.json
```

## v0 boundary

BuildGraph v0 implements the governed registry and validation foundation. It does not enable production deployments, external communications, payments, protected-branch merges, credential changes, autonomous high-consequence actions, or unrestricted runtime tool access.

## Repository map

| Path | Purpose |
|---|---|
| `schemas/` | Canonical machine-readable contracts. |
| `registry/` | Versioned canonical manifests, including organization, divisions, capabilities, agents, work, evidence, and runtimes. |
| `policies/` | Risk, authority, data-handling, and release controls. |
| `adapters/` | Runtime capability declarations, projection/receipt adapters, and the ClickUp Mission Control write adapter. |
| `graph/` | Deterministic canonical graph compiler, snapshot, and offline preflight. |
| `router/` | Manifest-driven capability router that emits bounded TaskEnvelope and AgentPassport records. |
| `evals/` | Role, skill, policy, and adapter evaluation suites. Currently a reserved tree; suites are planned in Unit 17-E. |
| `fixtures/` | Valid and invalid manifest/test data. |
| `tests/` | Registry and contract validation tests. |
| `docs/` | Architecture, governance, and decision records. |
| `graph/ontology.ts` | Executable relationship compatibility rules. |

## Core invariants

1. A role is a versioned contract; an agent instance is task-scoped and temporary.
2. Skills are reusable but never grant system access by themselves.
3. Integrations are least-privilege, role-specific, auditable, and fail closed.
4. A task must carry a canonical envelope, authority ceiling, and idempotency key.
5. A runtime cannot approve, release, publish, merge, pay, or attest to its own consequential output.
6. Consequential outputs require evidence, named authority, and an approval record.
7. Runtime-specific projections are derived from canonical manifests and are not the source of truth.

## Current implementation sequence

1. Foundation repository and governance baseline.
2. Identity rules and canonical schemas.
3. Policy packs, validation tooling, and registry quality gates.
4. Initial role, skill, and integration manifests.
5. Task, result, passport, and approval contracts.
6. Controlled runtime adapter interfaces and receipt normalization.
7. End-to-end validation.
8. Unit 15-E deterministic canonical graph compiler, validation report, snapshot, and preflight reuse query.
9. AOC Canonical Architecture v1, first-class ontology, capability registry, division manifests, runtime contract, and library reconciliation.

## Development

The repository uses Node.js and TypeScript. Run the validation suite after installing dependencies:

```bash
npm install
npm test
npm run lint
npm run typecheck
npm run generate:graph
npm run preflight -- --file docs/architecture/preflight/AOC_CANONICAL_ARCHITECTURE_REQUEST.json
```

See `docs/adr/ADR-001-buildgraph-v0-scope.md` for the original v0 authority boundary and `docs/adr/ADR-002-aoc-canonical-architecture-v1.md` for the canonical extension decision.

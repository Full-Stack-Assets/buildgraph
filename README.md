# BuildGraph

BuildGraph is a declarative control plane for governed, runtime-independent agentic work.

It stores versioned role, skill, integration, policy, workflow, runtime, task, approval, evidence, and evaluation manifests. Runtime adapters compile approved task-scoped definitions into bounded execution projections and normalize receipts back into a common evidence graph.

## v0 boundary

BuildGraph v0 implements the governed registry and validation foundation. It does not enable production deployments, external communications, payments, protected-branch merges, credential changes, autonomous high-consequence actions, or unrestricted runtime tool access.

## Repository map

| Path | Purpose |
|---|---|
| `schemas/` | Canonical machine-readable contracts. |
| `registry/` | Versioned role, skill, integration, policy, workflow, project, portfolio, and runtime manifests. |
| `policies/` | Risk, authority, data-handling, and release controls. |
| `adapters/` | Runtime capability declarations and projection/receipt adapters. |
| `compilers/` | Canonical manifest projection logic. |
| `evals/` | Role, skill, policy, and adapter evaluation suites. |
| `fixtures/` | Valid and invalid manifest/test data. |
| `tests/` | Registry and contract validation tests. |
| `docs/` | Architecture, governance, and decision records. |

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

## Development

The repository uses Node.js and TypeScript. Run the validation suite after installing dependencies:

```bash
npm install
npm test
npm run lint
npm run typecheck
```

See `docs/adr/ADR-001-buildgraph-v0-scope.md` for the v0 authority boundary.

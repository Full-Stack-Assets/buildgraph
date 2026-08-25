# AOC Repository Instructions

These provider-neutral instructions govern BuildGraph.

## Authority and Canon relationship

- Human Authority is final for consequential actions.
- `Full-Stack-Assets/Canon` is authoritative for AOC governance; this repository is authoritative for BuildGraph schemas, registry implementation, graph compilation, adapters, and project evidence.
- BuildGraph may compile and validate Canon-aligned definitions but must not become a competing policy or authority registry.
- Runtime projections and adapters are derived artifacts and never grant authority.

## Core invariants

- Roles, skills, capabilities, tools, integrations, and runtime adapters do not self-authorize.
- Agent instances are temporary and task-scoped.
- Every consequential task requires a canonical envelope, authority ceiling, evidence, and approval where applicable.
- Preserve deterministic graph generation, versioned manifests, relationship compatibility, and fail-closed validation.

## Required workflow

1. Run AOC and BuildGraph preflight before implementation.
2. Reuse, extend, or fork existing definitions before creating duplicates.
3. Inspect schemas, registries, policies, ADRs, adapters, and generated snapshots affected by the change.
4. Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run generate:graph`, and the applicable preflight fixture.
5. Record normalized evidence and unresolved graph or authority conflicts.

## Human Authority gates

Production deployment, external communication, payments, protected-branch merges, credential or access changes, enabling write-capable adapters, changing autonomy ceilings, and material canonical-architecture changes require explicit approval.

Never commit credentials or use runtime memory as an approval record.

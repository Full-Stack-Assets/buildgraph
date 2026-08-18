# BuildGraph Identifier and Namespace Policy

## Purpose

BuildGraph identifiers are stable, opaque enough to survive renaming, and constrained enough to validate reliably. Names may evolve; identifiers are never repurposed.

## Canonical namespaces

| Entity | Required format | Example |
|---|---|---|
| Role | `DOMAIN-###` | `GKE-06` |
| Skill | `SKL-###` | `SKL-008` |
| Integration category | `INT-###` | `INT-007` |
| Portfolio | lowercase slug | `full-stack-assets` |
| Project | lowercase slug with `._-` | `buildgraph-core` |
| Workflow | lowercase slug | `repository-cartography` |
| Runtime adapter | fixed runtime ID | `manus`, `openai`, `cursor`, `github`, `grok`, `claude` |
| Task | `task_<opaque>` | `task_01HABC...` |
| Trace | `trace_<opaque>` | `trace_01HABC...` |
| Artifact | `artifact_<domain>` | `artifact_repo.architecture-map:v1` |
| Approval | `approval_<opaque>` | `approval_01HABC...` |

## Versioning

Role, skill, integration, policy, workflow, project, and runtime-adapter manifests use semantic versioning. A breaking change to required inputs, permitted authority, output contract, integration scope, quality gate, or handoff requires a major version change.

## Immutability and lineage

1. A published identifier must not be reused for a different semantic entity.
2. Renames preserve the identifier and create a versioned metadata change.
3. Derived artifacts record parent artifact IDs and transformation/workflow version.
4. Runtime projections retain the canonical manifest ID and version that produced them.
5. Deprecated definitions move to a retired lifecycle state; they are not silently deleted.

## Reference rules

1. A role references only skills and integrations that exist in the canonical registry.
2. An integration may authorize only named role IDs.
3. A TaskEnvelope records exact role and workflow versions.
4. An AgentPassport is invalid if the task, role, integration scope, policy, or expiry reference cannot be resolved.
5. Human-readable names never replace IDs in machine validation or audit records.

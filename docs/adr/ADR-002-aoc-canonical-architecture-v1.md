# ADR-002: Adopt AOC Canonical Architecture v1 as a BuildGraph extension

- Status: Accepted
- Date: 2026-08-18
- Decision authority: Human Principal
- Architecture version: 1.0.0
- Decision manifest: `DEC-001`
- Preflight decision: `EXTEND_EXISTING`

## Context

BuildGraph already provided a deterministic, runtime-neutral registry and graph for Portfolio, Project, Role, Skill, Integration, Policy, Workflow, and Runtime entities. The generated baseline contained 40 entities and 69 relationships with zero validation errors.

The Agentic AI Role Library also existed, including exact duplicate document copies. Adding another standalone agent catalog would have increased naming and authority ambiguity.

The missing constitutional layer was first-class organization and division structure, capability-centered routing, definition/deployment separation, controlled relationship compatibility, runtime portability, evidence states, reconciliation, and versioned architecture change control.

## Preflight

The repaired deterministic offline preflight engine evaluated the proposal before the new canonical manifests were added.

- Payload: `docs/architecture/preflight/AOC_CANONICAL_ARCHITECTURE_REQUEST.json`
- Result: `docs/architecture/preflight/AOC_CANONICAL_ARCHITECTURE_RESULT.json`
- Payload hash: `cb31e48752ede701f810d9f5f1809f02d31b5bcbbf10d49865767d83142957db`
- Baseline graph hash: `e9e9d83600ca4920a56a11e2c568c5fc0c6d368e9f149537e8959bf8b1e9ccab`
- Closest project: `project:buildgraph-core`
- Waste Risk: 50, moderate

The result was `EXTEND_EXISTING`.

## Decision

Adopt the Agent Operating Company Canonical Architecture v1 inside the existing BuildGraph repository.

The decision adds:

- one Organization and exactly ten permanent Divisions;
- first-class Product, Capability, AgentDefinition, AgentInstance, Factory, WorkOrder, ExecutionRun, Tool, Provider, Evidence, Verification, Artifact, Decision, and Constraint entity schemas;
- a controlled relationship vocabulary and compatibility validator;
- a 13-capability seed registry;
- a Runtime Adapter Contract and profiles for OpenAI, Cursor, Manus, GitHub, Gemini, Grok, Claude, Codex, and local runtimes;
- an evidence-backed reconciliation matrix for the existing role, skill, and integration library;
- deterministic offline preflight as the authoritative engine, with any API treated as optional transport;
- versioned ADR enforcement for canonical architecture changes.

## Alternatives considered

### Continue with informal conversation artifacts

Rejected. Conversations are useful proposal surfaces but cannot enforce compatibility, versioning, evidence, or migration.

### Create a parallel AOC repository

Rejected. This would duplicate the BuildGraph control plane, split canonical memory, and create synchronization risk.

### Expand the agent catalog first

Rejected. The existing source library already contains 123 roles, 45 skills, and 20 integrations. Normalization and capability mapping have higher value than additional names.

### Require the live preflight API

Rejected as an authority dependency. An unavailable transport must not block deterministic local governance. The API may expose the same contract but cannot be the only source of truth.

## Consequences

Positive consequences:

- future builds have an unambiguous canonical home;
- projects request capabilities instead of vendor- or agent-specific labels;
- definitions can move across runtimes without rewriting company structure;
- duplicate source material is visible and does not become duplicate canon;
- relationship and authority errors fail validation;
- architecture proposals remain proposals until approved and versioned.

Costs and constraints:

- new manifests and runtime profiles must satisfy strict schemas;
- TESTED and VERIFIED claims require evidence;
- existing RoleSpec and SkillSpec aliases must be maintained through v1.x;
- changes to division boundaries, ontology, evidence states, or authority tiers require ADRs and migration.

## Migration

1. Preserve existing v0.2 manifests and graph IDs.
2. Treat RoleSpec as RoleDefinition and SkillSpec as SkillDefinition during v1.x.
3. Add v1 entity kinds and relationships additively.
4. Import source-library items through the reconciliation dispositions.
5. Promote only capability-backed, evidence-ready definitions.
6. Keep runtime/model/tool/credential bindings in AgentInstance and deployment configuration.
7. Regenerate and validate the graph after each canonical change.

## Backward compatibility

Existing Portfolio, Project, Role, Skill, Integration, Policy, Workflow, Runtime, TaskEnvelope, ResultEnvelope, and adapter contracts remain usable. New v1 manifests coexist in the same registry and graph.

A future removal of RoleSpec or SkillSpec aliases is a major-version change.

## Approval

The Human Principal explicitly authorized implementation after the `EXTEND_EXISTING` recommendation. This ADR records that authority; it does not delegate future architecture approval to an agent or runtime.

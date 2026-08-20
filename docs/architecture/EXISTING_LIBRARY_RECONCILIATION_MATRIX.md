---
status: EVIDENCE
version: 1.0.0
authority: architecture
scope: Agentic AI Role Library to BuildGraph v1
generated_from: verified source documents and canonical registry
---

# Existing Library Reconciliation Matrix

## Outcome

The source library contains 123 role entries, 45 skill entries, and 20 integration entries. BuildGraph also contains one additive integration, `INT-021`, that is not present in the source catalog.

The item-level matrix is [EXISTING_LIBRARY_RECONCILIATION_MATRIX.csv](./EXISTING_LIBRARY_RECONCILIATION_MATRIX.csv). It contains 198 classified records: 189 role/skill/integration records and nine source-document records.

| Source type | KEEP | SPECIALIZE | MISSING | ARCHIVE | Total |
|---|---:|---:|---:|---:|---:|
| Documents | 4 | 0 | 0 | 5 | 9 |
| Roles | 6 | 50 | 67 | 0 | 123 |
| Skills | 18 | 0 | 27 | 0 | 45 |
| Integrations | 6 | 0 | 15 | 0 | 21 |
| **Total** | **34** | **50** | **109** | **5** | **198** |

`MISSING` means the item exists in the source library but has not been promoted into the BuildGraph registry. It is not an instruction to create an agent.

## Source authority and duplicate evidence

The copies under `/Agent Roles & Skills Catalog/` are the authoritative source documents for this pass.

| Canonical source | SHA-256 | Duplicate source copies |
|---|---|---:|
| `00_LIBRARY_ARCHITECTURE.md` | `306bd5ca3b20f65a714f15a8b9c2440ee0e08bf04647bd64870310183eaced7a` | 1 |
| `01_CREATIVE_MEDIA_ROLE_CATALOG.md` | `93b0438a7b93b454beb91363ca4152beda8fc4a9f7b9dc783957858f48edd4df` | 1 |
| `02_CROSS_INDUSTRY_ROLE_CATALOG.md` | `898e5e914080696ff1761dcf5cbee80160745321ecf81ee0feb95d969db4fdc8` | 1 |
| `03_SKILL_AND_INTEGRATION_CATALOG.md` | `ec9c27def9db646e2e2bad2bd6a0c3c67b93a891cc0648d86af0d0112ae4258b` | 2 |

All five duplicate copies are byte-identical to their authoritative source. Their disposition is `ARCHIVE`; their rows must not be imported again. This implementation records the disposition but does not delete user source files.

## Current KEEP set

Registered roles:

- `ESP-01` Solution Architecture Agent
- `ESP-03` Code Review & Quality Agent
- `GKE-03` Approval & Delegation Steward
- `GKE-04` Audit Evidence Curator
- `GKE-05` Knowledge Base Curator
- `GKE-06` Research & Source Verification Agent

Registered skills:

`SKL-002`–`SKL-013` except `SKL-014`, plus `SKL-015`, `SKL-027`, `SKL-028`, `SKL-030`, `SKL-044`, and `SKL-045`.

Registered integrations reconciled to the source catalog:

`INT-001`, `INT-003`, `INT-005`, `INT-007`, and `INT-019`.

`INT-021` ClickUp Mission Control is a tested, additive BuildGraph integration and remains `KEEP`.

## Creative specialization treatment

The 50 creative-media roles are classified `SPECIALIZE` because they represent a vertical operating system rather than a second company hierarchy.

- Nine control or knowledge roles are RoleDefinition candidates: the six `CMO` roles and three `CMK` roles.
- The remaining 41 entries are initially recipe candidates. Their narrow production behavior should be expressed as capability requirements, skills, workflow stages, and gates unless durable accountability justifies a permanent RoleDefinition.
- Creative role IDs and source lineage are preserved even when the implementation form becomes a recipe.

This prevents “one narrow chatbot per task” while retaining the specialist knowledge in the source library.

## Capability gaps exposed by normalization

The seed Capability Registry deliberately records evidence honestly. Four capabilities currently have no registered provider role:

| Capability | Source candidates | Recommended normalization |
|---|---|---|
| CLIENT_CONVERSION | `RCP-03`, `RCP-04`, `RCP-05` | Promote one durable revenue accountability role; keep proposal drafting and follow-up as recipes |
| DATA_ANALYSIS | `DAA-02`, `DAA-03`, `DAA-08` | Promote a governed analysis role after reproducibility fixtures exist |
| MEDIA_GENERATION | Creative catalog | Keep permanent direction, continuity, rights, and quality roles; compose generation specialists as recipes |
| FINANCIAL_ANALYSIS | `FRC-01`, `FRC-02`, `FRC-03` | Promote only analysis/reconciliation roles with high-risk human approval boundaries |

Other partial gaps are visible even when a provider role exists. For example, `ESP-01` supplies architecture but not the full SOFTWARE_BUILD implementation function, and `ESP-03` supplies review evidence but not an independent deployment operator.

These are candidates for a later capability-gap decision. This reconciliation does not create them.

## Matrix semantics

| Column | Meaning |
|---|---|
| canonical_id | Stable source ID or source-document reconciliation ID |
| disposition | KEEP, SPECIALIZE, MISSING, or ARCHIVE in this pass |
| registry_state | Whether the item is registered, source-only, a canonical source, or a duplicate source |
| target_form | RoleDefinition, SkillDefinition, IntegrationDefinition, recipe candidate, or source document |
| home_division | Proposed accountable permanent division |
| operating_class | Canonical cross-industry operating class |
| functional_domains | Domain mapping; cross-domain where the source skill/integration is intentionally portable |
| capability_codes | Seed capabilities the item may provide or support; a mapping is not evidence of implementation |
| skill_ids | Existing canonical skill bindings when present |
| required_tools | Seed Tool IDs required by the mapped capabilities |
| risk_tier | Initial normalization tier; promotion requires item-specific review |
| autonomy_ceiling | Initial A-tier ceiling, independent of integration permission |
| integration_ceiling | Initial I-tier ceiling, independent of autonomy |
| runtime_compatibility | Portability requirement, not a vendor guarantee |
| evidence_status | Evidence state of the reconciliation claim |
| canonical_registry_path | Existing canonical manifest path when registered |
| normalization_note | Required action or rationale before promotion |

## Promotion rules

A source-only item is promoted only when:

1. a Capability gap or durable accountability need exists;
2. preflight returns `EXTEND_EXISTING` or justified `CREATE_NEW`;
3. the item has one home division and valid operating class/domain mappings;
4. overlaps are resolved against registered roles, skills, workflows, and recipes;
5. autonomy and integration ceilings are independently approved;
6. runtime compatibility is declared and then tested;
7. fixtures, acceptance criteria, failure behavior, and evidence requirements exist;
8. BuildGraph validation and change control pass.

The matrix is evidence for deliberate growth. It is not an agent-creation backlog.

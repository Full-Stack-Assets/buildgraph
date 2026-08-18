---
status: CANONICAL
version: 1.0.0
authority: architecture
canonical_id: DEC-001
effective_date: 2026-08-18
supersedes: prior informal hierarchy proposals
change_mode: VERSIONED_ONLY
---

# Agent Operating Company Canonical Architecture

## 1. Purpose and authority

This specification is the constitutional layer of the Agent Operating Company (AOC). It extends BuildGraph Core; it does not create a parallel control plane.

The Human Principal is the ultimate authority. BuildGraph stores the canonical definitions, relationships, policies, evidence, and decisions by which delegated agentic work is governed. Agentic Skill OS resolves and composes approved capabilities for execution. No model, conversation, project, vertical system, or runtime may silently redefine this architecture.

The following are non-negotiable:

1. Human authority remains above every autonomous system.
2. BuildGraph is the canonical memory and governance layer.
3. Capability is the primary unit of discovery and routing.
4. Definitions are portable; deployments are environment-specific.
5. Autonomy and integration permission are separate controls.
6. Consequential claims and actions require explicit evidence state.
7. Reuse and preflight precede creation.
8. Architecture changes are versioned decisions, never conversational drift.

## 2. Canonical system boundaries

| Layer | Owns | Must not own |
|---|---|---|
| Human Authority | Purpose, risk appetite, material approvals, exceptions, architecture acceptance | Routine machine execution details |
| AOC Architecture | Permanent divisions, ontology, authority model, operating classes, functional domains | Vendor-specific deployment settings |
| BuildGraph Core | Canonical registry, graph, relationship validation, policies, provenance, evidence, ADRs, preflight | Unrecorded runtime memory or provider secrets |
| Agentic Skill OS | Capability resolution, skill composition, recipes, workflows, factories, temporary pods, execution routing | Canonical organizational redefinition |
| Vertical Systems | Domain-specific intake and pre-work state machines | A duplicate execution architecture |
| Products and Projects | Outcomes, repositories, operating manifests, constraints, evidence requirements | New permanent divisions or shadow role libraries |
| Runtime Adapters | Model/tool projection, permission enforcement, receipts, provider-specific bindings | Canonical definitions |
| Execution Runs | Time-bound work, artifacts, evidence, metrics, exceptions | Durable policy or ontology changes |

### BuildGraph Core boundary

BuildGraph Core is the authoritative representation of:

- organizations, divisions, portfolios, products, projects, and work orders;
- roles, skills, capabilities, agent definitions, workflows, factories, and policies;
- runtimes, tools, providers, integrations, and deployment constraints;
- execution runs, artifacts, evidence, verification, decisions, and lineage;
- valid relationship types and compatibility rules;
- architecture versions, migrations, approvals, and preflight decisions.

### Agentic Skill OS boundary

Agentic Skill OS is the execution and composition layer. It may:

- resolve a requested capability to eligible roles, skills, tools, runtimes, and evidence;
- staff workflows and factories with approved definitions;
- create temporary pods for a work order;
- adapt a canonical package to a runtime through the Runtime Adapter Contract;
- emit execution, artifact, evidence, and verification records.

It may not create canonical entity types, permanent divisions, authority tiers, or relationship meanings without an approved architecture decision.

### Vertical-system boundary

A vertical system owns domain-specific qualification before common execution. For example, an opportunity system may own `Opportunity → Pursuit → WorkOrder`. Once a valid WorkOrder exists, Agentic Skill OS and BuildGraph govern execution. A vertical system must reference canonical capabilities and policies rather than cloning roles, skills, factories, or runtime logic.

## 3. Permanent divisions

The AOC has exactly ten permanent divisions. A role, capability, product, or policy has one accountable home division and may serve multiple functional domains.

| ID | Permanent division | Durable responsibility |
|---|---|---|
| DIV-01 | Command & Orchestration | Company coordination, priorities, approvals, exceptions, and cross-division routing |
| DIV-02 | Canon, Intelligence & Research | Canonical knowledge, evidence retrieval, source verification, and intelligence synthesis |
| DIV-03 | Product & Software Engineering | Product design, software delivery, repositories, testing, and engineering release readiness |
| DIV-04 | Automation & Agent Engineering | Agents, skills, workflows, factories, integrations, and portable automation |
| DIV-05 | Data, Analytics & Operational Intelligence | Governed data, analysis, forecasts, diagnostics, and operational intelligence |
| DIV-06 | Creative Media Production | Visual, audio, video, narrative, and brand-media production |
| DIV-07 | Release, Distribution & Compliance | Packaging, clearance, distribution, metadata, records, and compliance evidence |
| DIV-08 | Audience, Growth, Sales & Partnerships | Market opportunity, buyer understanding, conversion, growth, and partnerships |
| DIV-09 | Commercial Learning, Finance & Optimization | Financial analysis, commercial measurement, optimization, and organizational learning |
| DIV-10 | Independent Verification, Security & Governance | Independent tests, security review, policy assurance, evidence, and acceptance gates |

Adding, removing, splitting, merging, or renaming a permanent division is a major architecture change.

## 4. Canonical ontology

### 4.1 Organizational and work entities

| Entity | Meaning | Distinction |
|---|---|---|
| Organization | The governed company under Human Authority | Contains permanent divisions and owns products |
| Division | A permanent accountability boundary | Not a project team, runtime, or skill category |
| Portfolio | A governed collection of projects | Coordinates investment and policy defaults |
| Product | A durable value-bearing system or service | Persists across projects and releases |
| Project | A bounded change initiative | Uses capabilities to change or create products |
| WorkOrder | An authorized, executable unit of work | Carries scope, acceptance criteria, evidence, and authority ceilings |
| ExecutionRun | One time-bound attempt to execute a WorkOrder | Produces artifacts and evidence; never changes canon by implication |

A project operating manifest should normally have no project-specific roles. It declares required capabilities, factories, policies, runtime preferences, repositories, and evidence requirements, and references canonical definitions.

### 4.2 Role, skill, capability, and agent entities

| Entity | Canonical meaning |
|---|---|
| Role | A stable semantic accountability boundary: mission, scope, exclusions, gates, and handoffs |
| RoleDefinition | The versioned machine-readable representation of a Role. In BuildGraph v1, `RoleSpec` and graph type `Role` are backward-compatible aliases for RoleDefinition |
| SkillDefinition | A narrow, portable, independently testable procedure with inputs, outputs, limits, and fixtures. In v1, `SkillSpec` and graph type `Skill` are backward-compatible aliases |
| Capability | A provider-neutral statement of what the company can accomplish and the evidence required to claim it |
| AgentDefinition | A portable composition of role definitions, skills, capabilities, tools, policies, and authority ceilings |
| AgentInstance | An environment-specific deployment of an AgentDefinition with runtime, model, tool, integration, and credential-reference bindings |

A Capability is not a prompt, model, agent, role, or tool. It is the outcome-centered contract used to find valid implementations.

A Role is not an AgentInstance. A role can be realized by many AgentDefinitions; a definition can be deployed as many instances; an instance may be replaced without rewriting the role or capability.

### 4.3 Production-system entities

| Entity | Meaning |
|---|---|
| Recipe | A narrow reusable staffing and sequencing pattern expressed in required capabilities; it is normally represented inside a workflow or factory, not as a permanent employee |
| Workflow | A versioned sequence, state machine, or graph that requests capabilities and enforces gates |
| Factory | A reusable production system combining workflows, capabilities, roles, inputs, outputs, and controls |
| Pod | A temporary team assembled for one WorkOrder or stage; it dissolves after handoff |
| Tool | A typed action surface with a provider, permissions, supported capabilities, and audit behavior |
| Provider | The supplier of a runtime or tool; never the owner of canonical business definitions |
| Integration | A permissioned connection to a system of record or external service |
| Policy | A governing rule, authority boundary, or approval requirement |
| Constraint | A blocking or advisory invariant enforced by schema, compiler, validator, policy, or human approval |

Narrow labels such as “PR Review Agent,” “OAuth Debug Agent,” or “PDF Conversion Agent” should normally become recipes or workflow steps that request capabilities. A permanent AgentDefinition is justified only when the composition has durable accountability, policy, evaluation, or deployment requirements.

### 4.4 Evidence and change entities

| Entity | Meaning |
|---|---|
| Artifact | A versioned work product with URI, media type, checksum, lineage, and evidence state |
| Evidence | A traceable record supporting or refuting a claim about an artifact, capability, run, or decision |
| Verification | An independent method and result that assesses evidence, artifacts, or capabilities |
| Decision | A versioned architecture or operating choice with rationale, alternatives, migration, compatibility, and approval |

## 5. Capability-centered operation

The primary operating question is “What can the company do?” BuildGraph resolves that question through a capability record containing:

- stable capability code and purpose;
- home division and functional domains;
- operating classes;
- provider roles and implementing skills;
- required tools and policies;
- runtime support with evidence state;
- evidence requirements and verified execution history.

Workflows, factories, projects, products, and work orders request Capability IDs. Named agents and vendors are selected only after capability, policy, evidence, and authority filtering.

A valid route is:

`Capability → eligible RoleDefinitions/Skills → AgentDefinition → RuntimeAdapter → AgentInstance → ExecutionRun → Artifact/Evidence → Verification`

## 6. Operating classes

Every durable role and capability uses one or more of six operating classes.

| Value | Purpose |
|---|---|
| control | Coordinate work, preserve policy, route decisions, and enforce authority |
| knowledge | Retrieve, maintain, and govern approved knowledge |
| creation | Produce candidate artifacts from approved inputs |
| analysis | Diagnose, compare, model, and recommend from evidence |
| evaluation | Test artifacts, claims, controls, or systems against declared gates |
| delivery_operations | Package, operate, monitor, distribute, and support approved work |

Operating class describes how work is performed. Functional domain describes what business context it serves.

## 7. Functional domains

The canonical domains are:

1. governance-and-orchestration
2. knowledge-and-research
3. product-and-design
4. engineering-and-platform
5. data-analytics-and-ai
6. revenue-and-customer
7. operations-and-supply-chain
8. finance-risk-and-legal
9. people-and-learning
10. creative-media-and-brand
11. healthcare-and-public-service
12. built-environment-science-and-field

Domains may overlap divisions. They do not create new reporting lines.

## 8. Authority model

Autonomy and integration permission are orthogonal. A high-autonomy definition with no integration authority may analyze extensively but cannot act externally. A low-autonomy definition with a scoped integration may perform only the explicitly approved action.

### Autonomy tiers

| Tier | Maximum independent behavior |
|---|---|
| A0 | Retrieve or transform only under direct instruction; no independent selection |
| A1 | Draft, classify, and recommend within a fixed procedure |
| A2 | Plan and execute reversible multi-step work within approved scope; stop at material gates |
| A3 | Coordinate bounded workflows, retries, and temporary pods; human approval remains mandatory for material external or irreversible action |
| A4 | Reserved; prohibited unless a future architecture version defines specific controls and Human Authority approves it |

### Integration tiers

| Tier | Maximum external permission |
|---|---|
| I0 | No external integration |
| I1 | Read-only or draft-only access |
| I2 | Reversible scoped writes, branch changes, internal tasks, or sandbox execution |
| I3 | Sensitive or externally visible actions requiring explicit per-action approval |
| I4 | Irreversible, financial, legal, identity, safety-critical, or production authority; human-performed or specifically authorized |

A WorkOrder and AgentInstance use the lower of all applicable ceilings: organization, division, role, AgentDefinition, runtime, integration, policy, and task.

## 9. Definitions and deployments

### Definitions

Definitions are version-controlled, provider-neutral, and portable:

- RoleDefinition
- SkillDefinition
- Capability
- Workflow
- Factory
- Policy
- Constraint
- Schema
- Evaluation
- AgentDefinition

### Deployments

Deployments are environment-specific:

- AgentInstance
- runtime and model choice
- GPT, Gemini, Grok, Claude, Cursor, Codex, Manus, GitHub, or local configuration
- MCP and integration configuration
- credentials or secret references
- context and runtime limits
- tool bindings
- scheduled/background execution settings

Credential material must never appear in canonical manifests. Only credential references and policies are allowed.

## 10. Runtime portability

Every supported runtime conforms to `RUNTIME_ADAPTER_CONTRACT_v1`. A canonical AgentDefinition does not assume a vendor, model name, proprietary memory, or native tool. The adapter declares concrete support and evidence state.

Runtime compatibility is a claim, not a guess. It is recorded as:

- `DECLARED` when a profile exists but has no representative execution evidence;
- `TESTED` after repeatable contract tests;
- `VERIFIED` after independent acceptance against the declared capability;
- `SUPERSEDED` or `REVOKED` when the claim is no longer valid.

The runtime contract is defined in [RUNTIME_ADAPTER_CONTRACT_V1.md](./RUNTIME_ADAPTER_CONTRACT_V1.md).

## 11. Evidence states

| State | Meaning | May support production routing? |
|---|---|---|
| UNVERIFIED | Claim or artifact exists without sufficient evidence | No |
| DECLARED | Definition or compatibility is documented | Only in supervised pilot |
| TESTED | Representative tests passed with reproducible evidence | Yes, within tested scope and policy |
| VERIFIED | Independent acceptance confirmed the claim | Yes, within verified scope and policy |
| SUPERSEDED | A newer authoritative record replaces it | No new routing |
| REVOKED | Evidence or authority was invalidated | No |

Evidence states attach to capabilities, runtime support, AgentInstances, artifacts, and verification results. A state applies only to the tested version, scope, runtime, model, tools, inputs, and policy conditions.

## 12. Controlled relationships

Machine values are lower snake case and are defined by `schemas/relationship-type.schema.json`. The compiler validates source/relationship/target compatibility.

| Relationship | Canonical use |
|---|---|
| contains | Structural membership, such as Organization contains Division |
| owns | Accountable ownership, such as Division owns Capability |
| belongs_to | Inverse accountable or structural membership |
| requires | A definition or work object cannot execute without the target |
| provides | A role, agent definition, or provider supplies the target |
| implements | A SkillDefinition realizes a Capability |
| instantiates | An AgentDefinition realizes a RoleDefinition, or an AgentInstance realizes an AgentDefinition |
| uses | A bounded dependency without ownership |
| supports | A runtime or provider declares support for a target |
| produces | An ExecutionRun creates an Artifact or Evidence record |
| validates | Evidence or Verification supports a target claim |
| governed_by | The source is constrained by a Policy |
| governs | A Constraint applies to the target |
| authorizes | An Integration explicitly permits a RoleDefinition |
| executes | An ExecutionRun performs a WorkOrder |
| supplied_by | A Tool is supplied by a Provider |

Undefined relationship labels and incompatible triples are validation errors.

## 13. Reuse and preflight

Preflight is mandatory before creating a canonical entity, workflow, factory, project, integration, or architecture extension.

The deterministic local BuildGraph is the authoritative preflight engine. A live API may transport the same request and response but must not change scoring or decision semantics.

A preflight response includes:

- `decision`: `REUSE_EXISTING`, `EXTEND_EXISTING`, or `CREATE_NEW`;
- deterministic `payload_hash`;
- graph hash and matched entity evidence;
- closest projects and reusable source assets;
- purpose, capability, technology, feature, and overall similarity;
- overlap and gaps;
- justification;
- Waste Risk score and level.

Rules:

1. `REUSE_EXISTING`: use the canonical entity; changes require a normal version update.
2. `EXTEND_EXISTING`: add the missing behavior to the closest canonical entity or project and preserve its lineage.
3. `CREATE_NEW`: permitted only with explicit justification showing why reuse or extension cannot satisfy the need.
4. The proposal, preflight result, and final decision are retained as evidence.

The canonical AOC gate result is recorded under `docs/architecture/preflight/` and returned `EXTEND_EXISTING` for BuildGraph Core.

## 14. Library reconciliation and promotion

The Agentic AI Role Library is a source catalog, not automatically executable canon. Each item receives one disposition:

- KEEP
- MERGE
- SPECIALIZE
- RENAME
- DEPRECATE
- ARCHIVE
- MISSING

`MISSING` means present in the source catalog but not yet promoted into the BuildGraph registry. Promotion requires a canonical ID, home division, operating class, domains, capabilities, skills, tools, risk, autonomy ceiling, integration ceiling, runtime compatibility, and evidence state.

Exact duplicate source files are archived at the source-document level; their repeated rows do not become new entities. The current pass is recorded in the reconciliation matrix.

## 15. Architecture change control

A change to ontology, relationship meaning, division boundaries, authority tiers, evidence states, portability rules, or preflight semantics requires an Architecture Decision Record containing:

- current version;
- proposed change;
- reason;
- alternatives;
- affected entities;
- migration;
- backward compatibility;
- approval.

No approval means the proposal is noncanonical.

Version rules:

- patch: clarification or nonsemantic correction;
- minor: backward-compatible entity, field, or relationship addition;
- major: incompatible ontology, authority, division, or relationship change.

The canonical Markdown specification and machine-readable DecisionSpec must change together. Schema, compiler, manifests, generated graph, and migration evidence are part of the same change.

## 16. Validation and enforcement

A canonical release must pass:

1. strict JSON Schema compilation;
2. registry validation and unique-ID checks;
3. reference closure;
4. controlled relationship compatibility;
5. deterministic graph compilation and content hashing;
6. zero blocking graph errors;
7. relevant contract and regression tests;
8. artifact checksums and evidence records;
9. independent verification for claims promoted to VERIFIED.

Runtime availability, persuasive model output, or a successful conversation is not evidence of architectural validity.

## 17. Backward compatibility

BuildGraph v1 extends the v0.2 registry. Existing PortfolioSpec, ProjectSpec, RoleSpec, SkillSpec, IntegrationSpec, PolicySpec, WorkflowSpec, and RuntimeAdapter manifests remain valid.

For v1.x:

- `RoleSpec` represents RoleDefinition and retains graph type `Role`;
- `SkillSpec` represents SkillDefinition and retains graph type `Skill`;
- existing graph identifiers remain stable;
- new first-class types use additive manifests and controlled relationships;
- runtime deployments may migrate independently of canonical definitions.

Removing these compatibility aliases requires a future major-version ADR and migration.

## 18. Canonical implementation map

| Concern | Canonical location |
|---|---|
| Constitutional specification | `docs/architecture/AGENT_OPERATING_COMPANY_CANONICAL_ARCHITECTURE.md` |
| Entity schemas | `schemas/*-spec.schema.json` |
| Relationship vocabulary | `schemas/relationship-type.schema.json`, `graph/ontology.ts` |
| Organization and divisions | `registry/organizations/`, `registry/divisions/` |
| Capability registry | `registry/capabilities/` |
| Runtime profiles | `registry/runtimes/` |
| Runtime standard | `docs/architecture/RUNTIME_ADAPTER_CONTRACT_V1.md` |
| Reconciliation evidence | `docs/architecture/EXISTING_LIBRARY_RECONCILIATION_MATRIX.*` |
| Architecture decisions | `docs/adr/`, `registry/decisions/` |
| Preflight evidence | `docs/architecture/preflight/` |
| Generated canonical graph | `generated/buildgraph/` |

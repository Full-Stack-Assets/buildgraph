---
status: CANONICAL
version: 1.0.0
authority: architecture
contract_id: RUNTIME_ADAPTER_CONTRACT_v1
change_mode: VERSIONED_ONLY
---

# Runtime Adapter Contract v1

## 1. Purpose

This contract makes canonical agent packages portable across ChatGPT/OpenAI, Cursor, Manus, GitHub, Gemini, Grok, Claude, Codex, local runtimes, and future adapters.

A runtime adapter translates a provider-neutral TaskEnvelope, AgentDefinition, policy set, and capability request into one environment-specific execution. It then normalizes the outcome into BuildGraph ExecutionRun, Artifact, Evidence, and ResultEnvelope records.

An adapter is a controlled boundary, not a place to redefine roles, skills, capabilities, policies, or authority.

## 2. Normative profile

Every `RuntimeAdapter` manifest must declare the following under `spec.contract`.

| Field | Requirement |
|---|---|
| runtime_id | Stable ID from the canonical runtime vocabulary |
| supported_models | Deployment-selectable model identifiers or a provider-managed marker |
| supported_tools | Canonical Tool IDs or declared tool categories |
| supports_mcp | Whether this adapter can bind MCP tools in the declared deployment |
| supports_files | Whether task-scoped file input/output is supported |
| supports_repo_context | Whether repository context and repository artifacts are supported |
| supports_persistent_memory | Whether durable runtime memory is available and governed |
| supports_scheduled_execution | Whether future or recurring execution is supported |
| supports_background_execution | Whether execution may outlive the initiating interaction |
| supports_structured_output | Whether the adapter can enforce or validate structured results |
| permission_model | How authority, tool scope, native confirmation, and revocation are enforced |
| context_limits | Limit source, value when known, and operational notes |
| artifact_support | Artifact types the adapter can ingest or emit |
| authentication_model | Credential and user/deployment identity model; never secret material |
| known_constraints | Explicit limitations, disabled assumptions, and portability hazards |
| evidence_state | UNVERIFIED, DECLARED, TESTED, VERIFIED, SUPERSEDED, or REVOKED |
| supported_agent_definition_ids | AgentDefinitions with recorded adapter compatibility |

The JSON Schema is `schemas/runtime-adapter.schema.json`.

## 3. Required adapter behavior

An adapter must perform these stages in order:

1. Validate the TaskEnvelope and Agent Passport.
2. Resolve the canonical AgentDefinition, Capability, Policy, Tool, and Integration records by ID and version.
3. Compute the effective autonomy and integration ceilings using the lowest applicable limit.
4. Reject missing, expired, revoked, restricted, or out-of-scope authority.
5. Minimize and redact the runtime projection.
6. Bind only allowlisted tools and credential references.
7. Execute with the WorkOrder idempotency key and trace ID.
8. Intercept material external, irreversible, or approval-gated actions.
9. Normalize provider output into the canonical ResultEnvelope.
10. Record execution status, artifacts, checksums, evidence, costs, failures, and required human decisions.
11. Fail closed if contract validation, policy evaluation, or evidence capture cannot complete.

Native runtime confirmation does not replace BuildGraph approval. BuildGraph approval does not grant a provider permission that the deployment identity lacks.

## 4. Definition/deployment separation

The canonical package may include:

- AgentDefinition;
- RoleDefinition and SkillDefinition references;
- Capability and evidence requirements;
- Workflow or Factory references;
- policies and constraints;
- typed TaskEnvelope and output schema;
- evaluation fixtures.

The deployment package may include:

- runtime and model selection;
- tool and MCP bindings;
- repository/workspace configuration;
- credential references;
- context and cost limits;
- scheduled or background execution settings;
- provider-native safety and confirmation controls.

A deployment file may narrow canonical authority. It may never expand it.

## 5. Current profile matrix

These values describe the registered adapter contracts, not universal claims about every vendor product or plan.

| Runtime | MCP | Files | Repo context | Scheduled | Background | Structured output | Evidence |
|---|---:|---:|---:|---:|---:|---:|---|
| openai | yes | yes | no | yes | yes | yes | TESTED |
| cursor | yes | yes | yes | no | no | yes | TESTED |
| manus | no | yes | no | yes | yes | yes | TESTED |
| github | no | yes | yes | yes | yes | yes | TESTED |
| gemini | yes | yes | yes | no | no | yes | DECLARED |
| grok | no | yes | no | no | no | yes | DECLARED |
| claude | yes | yes | yes | no | yes | yes | DECLARED |
| codex | yes | yes | yes | yes | yes | yes | DECLARED |
| local | yes | yes | yes | no | no | yes | DECLARED |

A `DECLARED` value is a conservative adapter design claim. It becomes `TESTED` only after the adapter and its deployment pass the conformance suite. Unsupported or unverified features remain disabled.

## 6. Context and memory

Context limits are deployment facts and may change independently of the canonical package. The adapter records the effective model, context ceiling, truncation/minimization behavior, and source references with each run.

Persistent memory is disabled unless all of the following exist:

- an approved storage system and retention policy;
- explicit data classification and consent/authority;
- namespace and project isolation;
- source provenance and versioning;
- deletion, correction, and revocation behavior;
- evidence that retrieval does not bypass WorkOrder scope.

Canonical BuildGraph records are not runtime conversational memory.

## 7. Files, repositories, and artifacts

File and repository access is task-scoped. The adapter must:

- bind only approved paths, repositories, branches, and artifact locations;
- preserve source and derivative IDs;
- avoid silent overwrite of accepted masters;
- record checksums for consequential artifacts;
- separate drafts, candidates, approved outputs, and evidence;
- keep merge, deployment, deletion, public sharing, and secret access behind policy gates.

Repository support does not imply protected-branch merge or production-deployment authority.

## 8. Tool and MCP requirements

Each tool binding identifies:

- canonical Tool ID and version;
- provider and Integration ID, if any;
- input/output schema;
- maximum permission tier;
- allowed and prohibited actions;
- authentication reference;
- idempotency and retry behavior;
- audit and evidence fields;
- failure and revocation behavior.

An MCP server or provider-native tool is an implementation of a Tool contract. Tool discovery alone does not authorize use.

## 9. Authentication and secrets

Canonical definitions contain only credential references and handling policies. Adapters must not place plaintext secrets in prompts, manifests, logs, artifacts, evidence, or normalized receipts.

A valid adapter supports:

- deployment-scoped credentials;
- least-privilege scopes;
- explicit revocation;
- separation between runtime identity and Human Authority;
- rotation without canonical definition changes;
- audit linkage without secret disclosure.

## 10. Conformance suite

A runtime may be marked TESTED only when representative fixtures demonstrate:

1. valid structured input and output;
2. rejection of malformed envelopes;
3. rejection above autonomy or integration ceilings;
4. tool allowlist enforcement;
5. restricted-data minimization;
6. native confirmation and BuildGraph approval separation;
7. idempotent retry or documented non-retry;
8. normalized failure classification;
9. artifact and evidence capture;
10. trace, runtime, model, cost, and source fields;
11. credential revocation behavior;
12. fail-closed handling when policy or evidence services are unavailable.

VERIFIED additionally requires independent acceptance for the named capability and deployment.

## 11. Versioning

Backward-compatible fields may be added in a minor contract version. Removing a field, changing a field’s meaning, widening authority, or changing failure semantics requires a major version and ADR.

Runtime profiles can version independently, but each profile identifies the contract version it satisfies through schema and registry version control.

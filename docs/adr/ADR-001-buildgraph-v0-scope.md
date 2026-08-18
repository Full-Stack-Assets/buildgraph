# ADR-001: BuildGraph v0 Scope and Authority Boundary

**Status:** Accepted for implementation  
**Date:** 2026-08-17

## Decision

BuildGraph v0 is a private registry and validation foundation for governed, runtime-independent agentic work. Its initial purpose is to define and validate portable role, skill, integration, policy, workflow, task, result, passport, approval, evidence, and runtime-adapter contracts.

BuildGraph v0 uses a policy-first, serial implementation sequence. The initial runtime scope is Manus, GPT/OpenAI, Cursor, and GitHub. Grok and Claude remain deferred until role-specific evaluation evidence justifies their adapters.

The default v0 authority ceiling is **I2**. Roles may read approved scoped sources and create labeled drafts, internal work items, branches, pull requests, or sandbox artifacts only where a canonical IntegrationSpec explicitly permits the action. BuildGraph v0 does not enable I3 or I4 execution.

## Consequences

- The registry is the source of truth; runtime-specific instructions and configurations are derived projections.
- No external communication, public publication, protected-branch merge, production deployment, financial action, legal assertion, identity/permission change, or destructive system action is in v0 scope.
- Every canonical manifest requires a named owner, semantic version, lifecycle status, explicit boundaries, and validation evidence.
- Every meaningful agent instance requires a TaskEnvelope and temporary AgentPassport.
- Runtime output is valid only when it can be normalized into the canonical ResultEnvelope with required provenance, quality evidence, risks, and handoff information.
- ClickUp/Linear, Notion/Workspace, GitHub, and connected SaaS products remain native systems of record; BuildGraph stores governed references, artifacts, evidence, and policy context rather than indiscriminately replicating source data.

## Deferred decisions

The following decisions must be explicitly recorded before the corresponding implementation unit begins:

1. The first operational domain and pilot workflow.
2. The primary work-management source of truth and any ClickUp/Linear split.
3. The canonical knowledge source and document-retention model.
4. Human ownership for role, technical, data/integration, policy, and evaluation decisions.
5. The timing of persistent execution through Temporal and low-risk event ingress through n8n.
6. Any move above I2 or the addition of an action-capable production integration.

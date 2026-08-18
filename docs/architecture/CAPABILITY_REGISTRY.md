---
status: CANONICAL
version: 1.0.0
authority: architecture
registry: registry/capabilities
---

# Capability Registry v1

Capabilities are the primary discovery and routing surface of the Agent Operating Company. The machine-readable records are under `registry/capabilities/` and conform to `schemas/capability-spec.schema.json`.

| ID | Code | Home division | Registered provider role(s) | Evidence |
|---|---|---|---|---|
| CAP-001 | SOFTWARE_BUILD | DIV-03 | ESP-01 (partial: architecture) | DECLARED |
| CAP-002 | REPOSITORY_REVIEW | DIV-10 | ESP-03 | DECLARED |
| CAP-003 | DEPLOYMENT_VERIFICATION | DIV-10 | ESP-03 (review evidence) | DECLARED |
| CAP-004 | MARKET_RESEARCH | DIV-02 | GKE-06 | DECLARED |
| CAP-005 | OPPORTUNITY_DISCOVERY | DIV-08 | GKE-06 (research support) | DECLARED |
| CAP-006 | CLIENT_CONVERSION | DIV-08 | None registered | DECLARED |
| CAP-007 | CONTRACT_ANALYSIS | DIV-07 | GKE-06 (source verification support) | DECLARED |
| CAP-008 | DATA_ANALYSIS | DIV-05 | None registered | DECLARED |
| CAP-009 | AGENT_DESIGN | DIV-04 | ESP-01 | DECLARED |
| CAP-010 | MCP_INTEGRATION | DIV-04 | ESP-01 | DECLARED |
| CAP-011 | MEDIA_GENERATION | DIV-06 | None registered; creative recipes pending | DECLARED |
| CAP-012 | RELEASE_PACKAGING | DIV-07 | GKE-04 (evidence support) | DECLARED |
| CAP-013 | FINANCIAL_ANALYSIS | DIV-09 | None registered | DECLARED |

A provider-role mapping may be partial and does not by itself prove the full capability. The capability becomes TESTED or VERIFIED only when its declared role, skill, tool, runtime, policy, and evidence requirements pass representative execution.

## Resolution contract

A capability request is resolved in this order:

1. Find the Capability by stable code or ID.
2. Apply organization, division, project, WorkOrder, policy, risk, autonomy, and integration constraints.
3. Filter roles and skills by version and status.
4. Filter AgentDefinitions by tool and policy bindings.
5. Filter RuntimeAdapters and AgentInstances by evidence state and deployment support.
6. Rank eligible routes by verification evidence, recency, fitness, cost, and reversibility.
7. Execute through a WorkOrder and record artifacts, evidence, and verification.

If no eligible route remains, BuildGraph returns a capability gap. It does not fabricate an agent.

## Evidence query shape

A capability response should include:

- provider roles and implementing skills;
- eligible AgentDefinitions and AgentInstances;
- required tools, integrations, and policies;
- runtime support with evidence state;
- verified run count and evidence references;
- unresolved constraints;
- current best route and why it was selected.

Runtime support in the seed registry is `DECLARED`. Promotion to `TESTED` or `VERIFIED` is capability- and deployment-specific.

# BuildGraph v0 Implementation Status

**Status:** Foundation implemented and locally verified.  
**Execution boundary:** Registry, contract, validation, projection, and receipt-normalization only. No live runtime invocation, new connector activation, credential provisioning, scheduler, durable workflow worker, external communication, publication, protected-branch merge, deployment, payment, identity change, or destructive action is enabled.

## Completed units

| Unit | Delivered state | Verification |
|---:|---|---|
| 1 | Private repository, governance baseline, CI workflow, security policy, initial architecture decision record | Lint, typecheck, and foundation test pass |
| 2 | Canonical identifier policy and portfolio, project, role, skill, integration, policy, workflow, and runtime schemas | Strict JSON Schema compilation passes |
| 3 | Risk, approval, data, and release policy packs; fail-closed registry validation; integrity fixtures | Valid manifests pass; missing ownership fixture fails closed |
| 4 | Initial governed registry: 1 portfolio, 1 project, 6 roles, 19 skills, 5 integrations, and 4 policy records | Cross-reference and authority-tier validation passes |
| 5 | TaskEnvelope, ResultEnvelope, AgentPassport, and ApprovalRecord contracts with valid and invalid fixtures | Contract fixture suite passes |
| 6 | Controlled Manus, OpenAI, Cursor, and GitHub adapter interfaces and runtime capability manifests | Scope enforcement and receipt normalization suite passes |
| 7 | End-to-end controlled task path: task plus passport, runtime projection, receipt normalization, ResultEnvelope validation | End-to-end test passes |

## Current verification result

```text
BuildGraph registry validation passed for 39 manifest(s).
Test Files: 6 passed
Tests: 11 passed
```

## Enforced v0 controls

| Control | Enforced behavior |
|---|---|
| Authority ceiling | Runtime adapters reject task or passport authority above I2. |
| Scope binding | Passport task, trace, role, skill, integration scope, and authority must match the TaskEnvelope. |
| Runtime selection | Adapter rejects a runtime that is not named in both the task route and passport. |
| Consequential action | Adapter projections prohibit external messaging, publishing, protected-branch merge, deployment, financial action, identity change, and destructive action. |
| Registry integrity | Missing skill, integration, role, project, portfolio, or policy references fail validation. |
| Approval model | Approval records are modeled and validated but have an execution boundary of `disabled_in_v0`. |
| Evidence | Normalized result envelopes require provenance, quality evidence, risks or uncertainty, next handoff, and runtime metrics. |

## Deferred implementation units

The next serial implementation increment is a pilot-specific workflow and owner-approved integration binding. It requires a selected operating domain, named accountable owners, a source-of-truth decision for work and knowledge, and an explicit decision on whether any nonproduction I3 action is permitted. Until those decisions are recorded, BuildGraph remains intentionally limited to its validated I0–I2 foundation.

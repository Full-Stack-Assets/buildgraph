# Agentic Ecosystem Archive Mapping

## Canonical reconciliation

| Archive unit | Supplied artifact | BuildGraph disposition | Implementation state |
|---:|---|---|---|
| 1 | Grok Operations inventory | Preserve as user-supplied external-runtime inventory; do not treat reported active status as a verified BuildGraph execution state | Recorded in `ARCHIVE_RECONCILIATION_NOTES.md` |
| 2 | Universal Grok roles and skills | Convert compatible records into canonical `RoleSpec` and `SkillSpec` with lineage; preserve Grok IDs and action-level semantics | Pending import after router foundation |
| 3 | Integration Registry | Map each source connection to `IntegrationSpec`; retain exact object/field constraints and fail-closed behavior; do not provision credentials or change any connection | Inventory mapping pending |
| 4 | Runtime Adapters | The BuildGraph controlled adapter contract is richer than the archive stub. Manus, OpenAI, Cursor, and GitHub adapters are implemented; Grok and Claude remain declared runtime IDs pending verified adapter implementation | Partial implementation complete |
| 5 | Task Envelope and Agent Passport | BuildGraph canonical schemas supersede the archive drafts, with explicit task/trace binding, authority ceiling, idempotency, expiry, and result normalization | Complete |
| 6 | Capability Router | Implement a deterministic, manifest-driven selector that returns a proposed runtime route and requires a valid TaskEnvelope and AgentPassport before projection | Next compatible unit |
| 7 | Google Sheets Control Plane | Represent the reported control plane as a governed external system inventory and kill-switch policy input; do not write to the Sheet or rely on unverified operational state | Deferred integration binding |
| 8 | Event Fabric | Requires router and verified connection contracts; no webhook or scheduled automation is activated | Deferred |
| 9 | Policy and Credential Broker | Requires brokered short-lived credentials and real connector binding; current policy and passport layers are preparation only | Deferred |
| 10 | Durable Execution | Requires a concrete long-running workflow and persistent execution decision | Deferred |
| 11 | Evidence and Observability | Canonical result evidence and quality receipts are implemented; external observability backend remains deferred | Partial implementation complete |
| 12 | Agent Reputation | Requires adequate task/evaluation history and a reviewable score model | Deferred |
| 13 | Multi-Agent Competition | Requires stable role fixtures and comparable runtime evaluations | Deferred |
| 14 | Autonomous Domain Loops | Requires proven supervised domain workflows and explicit authority expansion | Deferred |

## Semantic mapping rules

| Archive concept | Canonical BuildGraph equivalent | Constraint |
|---|---|---|
| L0–L4 action level | Risk/policy decision layered over I0–I4 technical integration access | Action level and technical access tier remain separate. |
| `writes_enabled` and similar switches | Kill-switch policy input | Any unavailable, false, stale, or unverified switch state fails closed. |
| `payload_hash` | ApprovalRecord action-payload digest field | Approval is invalid if the exact proposed payload changes. |
| Control Plane Runs receipt | ResultEnvelope plus EvidenceRecord reference | A claimed external effect requires native receipt evidence. |
| Grok role/skill identifier | Lineage/source identifier | Canonical BuildGraph IDs stay distinct where existing ID patterns require it. |
| Reported live integration health | Connector inventory evidence | BuildGraph does not assume a reported connection is live or authorize it. |

## Next implementation boundary

The router will operate only against canonical BuildGraph records. It will produce a recommendation and a bounded task/passport validation request. It will not invoke an external runtime, make a network call, alter a kill switch, create a scheduled job, write to the reported Google Sheet, or execute an action.

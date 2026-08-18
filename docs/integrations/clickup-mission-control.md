# ClickUp Mission Control Public API Adapter

## Purpose

BuildGraph uses ClickUp as an operational Mission Control surface while avoiding dependence on the hosted ClickUp MCP quota for autonomous or high-volume machine writes.

The intended split is:

- **ClickUp MCP:** conversational, interactive, low-volume access from an AI client.
- **ClickUp Public API adapter:** governed machine writes from BuildGraph workers, runtimes, and event-driven automation.

The adapter is bounded by `registry/integrations/INT-021-clickup-mission-control.yaml` at integration tier I2.

## Current Mission Control mapping

The non-secret lane map is stored in `config/clickup-mission-control.json`.

Workspace: `90141126753`

The adapter accepts semantic lanes instead of arbitrary destination list IDs:

- `command_queue`
- `canonical_registry`
- `integration_registry`
- `runtime_agent_work`
- `approvals_policy_gates`
- `exceptions_blockers`
- `evidence_verification`
- `event_fabric_automations`
- `durable_workflows`
- `observability_health`
- `routing_reputation_experiments`
- `autonomous_domain_loops`

An agent cannot use `createWorkItem()` to select a list outside this configured map.

## Authentication

The adapter uses a ClickUp API token supplied at runtime through `CLICKUP_API_TOKEN`. Do not commit the token to the repository.

For a private single-user deployment, a ClickUp personal API token can be injected as the runtime secret. For a later multi-user service, the same adapter can receive OAuth access tokens without changing its calling interface.

The authenticated ClickUp MCP connection is separate from this runtime secret. BuildGraph does not attempt to extract or reuse an opaque connector credential.

## Environment

Start from `.env.example` or inject the same values through a secret manager:

```bash
CLICKUP_API_TOKEN=<inject-securely>
CLICKUP_WORKSPACE_ID=90141126753
BUILDGRAPH_CLICKUP_IDEMPOTENCY_PATH=.runtime/clickup-idempotency.json
BUILDGRAPH_CLICKUP_CONCURRENCY=2
BUILDGRAPH_CLICKUP_MAX_PENDING=100
```

Optional:

```bash
CLICKUP_API_BASE_URL=https://api.clickup.com/api/v2
```

The runtime fails closed when `CLICKUP_API_TOKEN` is absent, when `CLICKUP_WORKSPACE_ID` is absent, or when the supplied Workspace ID does not match the committed Mission Control map.

## Activation

```ts
import {
  createClickUpMissionControlFromEnvironment,
  loadMissionControlConfig
} from "../../adapters/clickup/index.js";

const config = await loadMissionControlConfig("config/clickup-mission-control.json");
const clickup = createClickUpMissionControlFromEnvironment({ config });

const verification = await clickup.verifyConnection();
console.log(verification);
```

`verifyConnection()` is read-only. It verifies the authenticated ClickUp user and confirms access to the configured Workspace before any write is attempted.

## Governed writes

### Create a work item

```ts
const result = await clickup.createWorkItem({
  lane: "runtime_agent_work",
  name: "Run repository verification",
  description: "Execute the assigned BuildGraph verification envelope.",
  idempotencyKey: "task_01JXYZ:create-clickup-work-item"
});
```

### Update reversible task metadata

```ts
await clickup.updateWorkItem({
  taskId: result.taskId,
  description: "Verification is running.",
  idempotencyKey: "task_01JXYZ:update-running-description"
});
```

### Consequential status transitions

Protected approval, release, completion, closed, or done states require an approval record reference:

```ts
await clickup.updateWorkItem({
  taskId: result.taskId,
  status: "complete",
  approvalRecordReference: "approval_01JXYZ",
  idempotencyKey: "task_01JXYZ:complete"
});
```

The approval reference is used by BuildGraph as a policy precondition. It is not treated as a ClickUp credential.

## Rate limiting and retries

The transport does not hardcode a ClickUp plan-specific throughput assumption. It reads the `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` response headers and exposes the latest snapshot through `health()`.

Behavior:

- `429`: wait until the server reset time when provided, then retry within the configured attempt limit.
- retryable `5xx`: bounded exponential backoff.
- non-retryable `4xx`: fail immediately.
- queue overflow: reject rather than silently drop work.

The initial runtime queue is intentionally conservative. Increase concurrency only after observing real API headers and workload behavior.

## Idempotency

All mutations require a BuildGraph idempotency key.

The default runtime uses `JsonFileIdempotencyStore` and writes only operation state plus normalized mutation results to `.runtime/clickup-idempotency.json`. The directory is ignored by Git.

Confirmed successful mutations are replay-safe within that ledger: calling the same completed key returns the stored result without issuing another ClickUp write.

The JSON store is suitable for a single local worker process. A distributed runtime should replace it with a shared transactional `IdempotencyStore` implementation before horizontally scaling workers.

## Authority boundary

This adapter intentionally does **not** expose:

- task deletion;
- workspace/Space/Folder/List administration;
- permission changes;
- billing operations;
- credential management;
- self-approval of consequential output;
- production deployment actions.

Its purpose is to make ClickUp a high-throughput governed control surface, not to turn a task-scoped agent into a ClickUp administrator.

## Verification

Repository tests cover:

- authorization and JSON request formation;
- rate-limit header parsing;
- reset-aware `429` retry;
- non-retry of authorization failures;
- persistent idempotency;
- pending-key fail-closed behavior;
- bounded queue concurrency and overflow;
- semantic lane whitelisting;
- completed-write deduplication;
- approval gating for protected status transitions;
- failed-write retry behavior;
- read-only connection verification;
- environment and Workspace validation;
- integration registry validation.

## Live activation boundary

The repository implementation can be fully verified without a real ClickUp secret. A real Public API smoke check requires `CLICKUP_API_TOKEN` to be injected into the runtime securely. Until that occurs, do not claim that the direct Public API path is live even if the hosted ClickUp MCP connection is authenticated.

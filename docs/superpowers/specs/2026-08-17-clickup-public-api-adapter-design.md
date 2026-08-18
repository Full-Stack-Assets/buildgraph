# ClickUp Public API Adapter Design

## Goal

Use ClickUp as BuildGraph Mission Control without depending on ClickUp's hosted MCP quota for machine-generated writes. Keep MCP available for conversational access while routing autonomous and high-volume task writes through ClickUp's Public API.

## Placement

The adapter lives in `adapters/clickup/` because BuildGraph is the governed control plane and already owns integration manifests, task idempotency, authority ceilings, evidence, and runtime-independent execution contracts.

`INT-003 project-workflow-management` remains the generic project/workflow integration contract. A new provider manifest, `INT-021 clickup-mission-control`, binds that capability to the user's current ClickUp Mission Control workspace.

## Architecture

### 1. HTTP client

`ClickUpClient` wraps native Node 22 `fetch` and is the only module allowed to construct ClickUp HTTP requests. It:

- sends `Authorization: <token>` without logging the token;
- targets `https://api.clickup.com/api/v2` by default;
- parses `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`;
- retries `429` and retryable `5xx` responses;
- waits until the server reset time for `429` when available, otherwise uses bounded exponential backoff;
- never retries non-retryable `4xx` responses;
- exposes its latest rate-limit snapshot for observability.

### 2. Mission Control lane router

The adapter does not accept arbitrary list IDs from an agent. It resolves a small semantic lane enum to the known ClickUp list IDs created for Mission Control:

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

This prevents a task-scoped agent from writing into arbitrary ClickUp lists.

### 3. Idempotency

Every mutating operation requires a BuildGraph idempotency key. A pluggable `IdempotencyStore` records `pending` and `completed` operations. The first implementation includes:

- `MemoryIdempotencyStore` for tests and ephemeral runtimes;
- `JsonFileIdempotencyStore` for a durable local process, using atomic temp-file replacement.

A completed key returns the stored result and does not issue a second ClickUp write. A pending key fails closed rather than duplicating a possibly in-flight mutation.

### 4. Bounded write queue

`BoundedAsyncQueue` caps pending writes and execution concurrency. Queue overflow rejects immediately. The queue is intentionally generic and does not silently discard work.

The public adapter defaults to conservative concurrency and relies on the ClickUp response headers rather than hardcoding a plan-specific rate limit.

### 5. Governed operations

The first provider supports only:

- create task in an approved Mission Control lane;
- update a task's reversible metadata;
- add a task comment;
- read task state;
- inspect adapter health.

It intentionally exposes no delete-task, workspace-admin, permission, billing, or credential operations.

Protected status transitions such as approved/release/completed require an `approvalRecordReference`. This preserves BuildGraph's v0 rule that consequential output cannot self-approve.

### 6. Authentication

The adapter accepts a token supplied at runtime. Initial activation may use a ClickUp personal token for this private single-user control plane. The interface does not depend on token shape, so OAuth can replace it without changing calling code.

Required runtime values:

- `CLICKUP_API_TOKEN`
- `CLICKUP_WORKSPACE_ID`

Optional values:

- `CLICKUP_API_BASE_URL`
- `BUILDGRAPH_CLICKUP_IDEMPOTENCY_PATH`

No credential is committed to the repository.

## Data flow

1. A BuildGraph worker produces a task-scoped operation with an idempotency key.
2. The Mission Control adapter validates the requested lane and operation.
3. Protected status changes are rejected without an approval reference.
4. The idempotency store is checked.
5. The operation enters the bounded queue.
6. `ClickUpClient` sends the request and applies rate-limit/retry behavior.
7. The response is normalized into a small BuildGraph-facing result.
8. The idempotency record is marked completed only after a successful response.
9. Health exposes queue depth, last rate-limit snapshot, and last transport error.

## Failure behavior

- Missing token or workspace ID: fail closed during construction/configuration.
- Unknown lane: reject before HTTP.
- Duplicate completed key: return prior result without HTTP.
- Duplicate pending key: reject as already in progress.
- `401`/`403`: no retry; surface authentication/authorization failure.
- `429`: honor ClickUp reset headers and retry within configured attempt limits.
- retryable `5xx`: bounded exponential backoff.
- queue overflow: reject and leave the caller responsible for durable upstream retry.
- failed mutation: idempotency key is released so an explicit upstream retry can run again.

## Testing

Vitest tests use an injected fetch function and injected clock/sleep functions. Tests must prove:

- Authorization and JSON request formation;
- rate-limit header parsing;
- `429` reset-aware retry;
- non-retry of `4xx` failures;
- lane whitelisting;
- one HTTP write for duplicate completed idempotency keys;
- protected-status approval gating;
- queue overflow behavior;
- durable JSON idempotency round trip;
- registry manifest validation through the existing repository validator.

## Non-goals for this pass

- replacing ClickUp MCP for interactive ChatGPT reads/writes;
- creating or administering ClickUp workspaces, spaces, folders, lists, or Docs;
- webhook ingestion;
- persistent distributed queue infrastructure;
- Redis/Postgres idempotency backends;
- automatic OAuth app registration;
- production deployment.

These can be added behind the same interfaces without changing the first-pass contract.
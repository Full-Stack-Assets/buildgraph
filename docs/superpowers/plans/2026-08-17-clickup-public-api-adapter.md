# ClickUp Public API Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a governed ClickUp Public API write path for BuildGraph Mission Control so autonomous writes are not constrained by the hosted MCP daily quota.

**Architecture:** A native-fetch ClickUp client owns authentication, retry, and rate-limit handling. A Mission Control facade restricts writes to named lanes, wraps all mutations in idempotency and a bounded async queue, and requires approval references for consequential status transitions.

**Tech Stack:** Node.js >=22, TypeScript 5.9, native `fetch`, Vitest 3, YAML registry manifests.

**Spec:** `docs/superpowers/specs/2026-08-17-clickup-public-api-adapter-design.md`

## Global Constraints

- Do not commit ClickUp credentials.
- Do not add delete, billing, permission, credential, workspace-admin, or production-deployment operations.
- All mutations require an idempotency key.
- Unknown Mission Control lanes fail closed.
- Protected approval/release/completion status transitions require an approval record reference.
- Honor ClickUp rate-limit response headers and bound retries.
- Preserve existing BuildGraph v0 I2 authority ceiling and evidence model.

---

### Task 1: Define ClickUp transport types and client

**Files:**
- Create: `adapters/clickup/types.ts`
- Create: `adapters/clickup/client.ts`
- Test: `tests/clickup-client.test.ts`

**Interfaces:**
- Produces: `ClickUpClient`, `ClickUpClientOptions`, `ClickUpRateLimitSnapshot`, `ClickUpHttpError`.
- `ClickUpClient.request<T>(method, path, body?) -> Promise<T>` is the only HTTP entry point used by later tasks.

- [ ] **Step 1: Write failing client tests**

```ts
it("adds Authorization and parses rate-limit headers", async () => {
  const fetchFn = vi.fn(async () => new Response(JSON.stringify({ id: "task-1" }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-ratelimit-limit": "100",
      "x-ratelimit-remaining": "99",
      "x-ratelimit-reset": "1893456000"
    }
  }));
  const client = new ClickUpClient({ token: "pk_test", fetchFn });
  await client.request("GET", "/task/task-1");
  expect(fetchFn).toHaveBeenCalledTimes(1);
  expect(client.rateLimitSnapshot?.remaining).toBe(99);
});
```

```ts
it("retries 429 using reset time", async () => {
  const responses = [
    new Response("rate limited", { status: 429, headers: { "x-ratelimit-reset": "1001" } }),
    new Response(JSON.stringify({ id: "task-1" }), { status: 200, headers: { "content-type": "application/json" } })
  ];
  const sleep = vi.fn(async () => undefined);
  const client = new ClickUpClient({ token: "pk_test", now: () => 1_000_000, sleep, fetchFn: vi.fn(async () => responses.shift()!) });
  await client.request("GET", "/task/task-1");
  expect(sleep).toHaveBeenCalledWith(1000);
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm test -- tests/clickup-client.test.ts`
Expected: FAIL because `adapters/clickup/client.ts` does not exist.

- [ ] **Step 3: Implement minimal client**

Implement native `fetch`, `Authorization`, JSON serialization, header parsing, `429`/`5xx` retry, and typed HTTP errors. No logging of tokens.

- [ ] **Step 4: Run client tests**

Run: `npm test -- tests/clickup-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add adapters/clickup/types.ts adapters/clickup/client.ts tests/clickup-client.test.ts
git commit -m "feat: add ClickUp API transport"
```

### Task 2: Add idempotency stores

**Files:**
- Create: `adapters/clickup/idempotency.ts`
- Test: `tests/clickup-idempotency.test.ts`

**Interfaces:**
- Produces: `IdempotencyStore`, `MemoryIdempotencyStore`, `JsonFileIdempotencyStore`.
- `get(key)`, `begin(key)`, `complete(key, result)`, and `release(key)` are used by the facade.

- [ ] **Step 1: Write failing tests**

```ts
it("persists completed results in JSON", async () => {
  const store = new JsonFileIdempotencyStore(path);
  await store.begin("k1");
  await store.complete("k1", { taskId: "abc" });
  const reloaded = new JsonFileIdempotencyStore(path);
  expect(await reloaded.get("k1")).toEqual({ state: "completed", result: { taskId: "abc" } });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/clickup-idempotency.test.ts`
Expected: FAIL because implementation is absent.

- [ ] **Step 3: Implement memory and atomic JSON-file stores**

Use `mkdir`, temp-file write, and `rename`. Never persist credentials or request bodies, only idempotency state and normalized results.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/clickup-idempotency.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add adapters/clickup/idempotency.ts tests/clickup-idempotency.test.ts
git commit -m "feat: add ClickUp idempotency ledger"
```

### Task 3: Add bounded async write queue

**Files:**
- Create: `adapters/clickup/queue.ts`
- Test: `tests/clickup-queue.test.ts`

**Interfaces:**
- Produces: `BoundedAsyncQueue.enqueue<T>(() => Promise<T>)`, `pending`, and `active`.

- [ ] **Step 1: Write failing queue tests**

```ts
it("rejects queue overflow instead of dropping work", async () => {
  const queue = new BoundedAsyncQueue({ concurrency: 1, maxPending: 1 });
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => { release = resolve; });
  const first = queue.enqueue(async () => blocker);
  const second = queue.enqueue(async () => "queued");
  await expect(queue.enqueue(async () => "overflow")).rejects.toThrow("queue capacity exceeded");
  release();
  await Promise.all([first, second]);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/clickup-queue.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement bounded FIFO queue**

No external dependencies. Keep concurrency configurable and default it conservatively in the facade.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/clickup-queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add adapters/clickup/queue.ts tests/clickup-queue.test.ts
git commit -m "feat: add bounded ClickUp write queue"
```

### Task 4: Add Mission Control facade and lane guard

**Files:**
- Create: `adapters/clickup/mission-control.ts`
- Create: `adapters/clickup/index.ts`
- Create: `config/clickup-mission-control.json`
- Test: `tests/clickup-mission-control.test.ts`

**Interfaces:**
- Produces: `ClickUpMissionControl`, `MissionControlLane`, `MissionControlConfig`.
- Supports: `createWorkItem`, `updateWorkItem`, `addComment`, `getTask`, `health`.

- [ ] **Step 1: Write failing governance tests**

```ts
it("deduplicates completed create writes", async () => {
  const result1 = await control.createWorkItem({ lane: "command_queue", name: "Task", idempotencyKey: "task_123:create" });
  const result2 = await control.createWorkItem({ lane: "command_queue", name: "Task", idempotencyKey: "task_123:create" });
  expect(result2).toEqual(result1);
  expect(fetchFn).toHaveBeenCalledTimes(1);
});
```

```ts
it("requires approval reference for protected status", async () => {
  await expect(control.updateWorkItem({ taskId: "x", status: "COMPLETED", idempotencyKey: "x:complete" }))
    .rejects.toThrow("approval record reference required");
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/clickup-mission-control.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the lane router and governed facade**

Use only configured lane IDs. No method may accept an arbitrary destination list for creates. Release failed idempotency records so explicit retries can run again.

- [ ] **Step 4: Add the current Mission Control mapping**

`config/clickup-mission-control.json` contains the current workspace and the 12 list IDs created in ClickUp. It contains no secret.

- [ ] **Step 5: Run facade tests**

Run: `npm test -- tests/clickup-mission-control.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add adapters/clickup config/clickup-mission-control.json tests/clickup-mission-control.test.ts
git commit -m "feat: add governed ClickUp Mission Control adapter"
```

### Task 5: Register the concrete ClickUp integration

**Files:**
- Create: `registry/integrations/INT-021-clickup-mission-control.yaml`

**Interfaces:**
- Produces a provider-specific IntegrationSpec at I2.

- [ ] **Step 1: Add provider manifest**

Use `authentication.method: delegated_user`, permit read/draft/reversible writes to Mission Control tasks, require confirmation for approval/release/completion transitions, prohibit deletes and workspace administration, and fail closed.

- [ ] **Step 2: Validate registry**

Run: `npm run validate:registry`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add registry/integrations/INT-021-clickup-mission-control.yaml
git commit -m "feat: register ClickUp Mission Control integration"
```

### Task 6: Document activation and verify repository

**Files:**
- Create: `docs/integrations/clickup-mission-control.md`

**Interfaces:**
- Documents environment variables and safe activation only. No token value is included.

- [ ] **Step 1: Document activation**

Include:

```bash
export CLICKUP_API_TOKEN="<personal-or-oauth-token>"
export CLICKUP_WORKSPACE_ID="90141126753"
export BUILDGRAPH_CLICKUP_IDEMPOTENCY_PATH=".runtime/clickup-idempotency.json"
```

Explain that a personal token is suitable for private single-user use and OAuth is the later multi-user path.

- [ ] **Step 2: Run full verification**

Run: `npm run validate`
Expected: lint, typecheck, registry validation, and tests all PASS.

- [ ] **Step 3: Commit documentation**

```bash
git add docs/integrations/clickup-mission-control.md
git commit -m "docs: add ClickUp adapter activation guide"
```

- [ ] **Step 4: Open a PR**

Open `codex/clickup-public-api-adapter` against `main` and let repository CI independently verify the branch.

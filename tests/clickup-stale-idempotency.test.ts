import { describe, expect, it, vi } from "vitest";
import { ClickUpClient } from "../adapters/clickup/client.js";
import { MemoryIdempotencyStore } from "../adapters/clickup/idempotency.js";
import { ClickUpMissionControl } from "../adapters/clickup/mission-control.js";
import type { MissionControlConfig } from "../adapters/clickup/mission-control.js";
import { BoundedAsyncQueue } from "../adapters/clickup/queue.js";

const config: MissionControlConfig = {
  workspaceId: "workspace-test",
  lists: {
    command_queue: "list-command",
    canonical_registry: "list-canonical",
    integration_registry: "list-integrations",
    runtime_agent_work: "list-runtime",
    approvals_policy_gates: "list-approvals",
    exceptions_blockers: "list-exceptions",
    evidence_verification: "list-evidence",
    event_fabric_automations: "list-events",
    durable_workflows: "list-durable",
    observability_health: "list-health",
    routing_reputation_experiments: "list-routing",
    autonomous_domain_loops: "list-domains"
  }
};

describe("ClickUp stale idempotency recovery", () => {
  it("reclaims a stale pending mutation lease after a worker restart", async () => {
    const store = new MemoryIdempotencyStore(() => "2026-08-18T02:00:00.000Z");
    await store.begin("task_stale:create");

    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      id: "cu-recovered",
      url: "https://app.clickup.com/t/cu-recovered"
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));

    const control = new ClickUpMissionControl({
      client: new ClickUpClient({ token: "pk_test", fetchFn: fetchFn as typeof fetch, maxRetries: 0 }),
      config,
      idempotencyStore: store,
      queue: new BoundedAsyncQueue({ concurrency: 1, maxPending: 4 }),
      pendingLeaseMs: 5 * 60 * 1000,
      now: () => Date.parse("2026-08-18T03:00:00.000Z")
    });

    await expect(control.createWorkItem({
      lane: "command_queue",
      name: "Recovered task",
      idempotencyKey: "task_stale:create"
    })).resolves.toMatchObject({ action: "created", taskId: "cu-recovered" });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await store.get("task_stale:create")).toMatchObject({ state: "completed" });
  });

  it("still rejects a fresh in-progress mutation", async () => {
    const store = new MemoryIdempotencyStore(() => "2026-08-18T02:59:30.000Z");
    await store.begin("task_fresh:create");

    const control = new ClickUpMissionControl({
      client: new ClickUpClient({ token: "pk_test", fetchFn: vi.fn() as unknown as typeof fetch, maxRetries: 0 }),
      config,
      idempotencyStore: store,
      queue: new BoundedAsyncQueue({ concurrency: 1, maxPending: 4 }),
      pendingLeaseMs: 5 * 60 * 1000,
      now: () => Date.parse("2026-08-18T03:00:00.000Z")
    });

    await expect(control.createWorkItem({
      lane: "command_queue",
      name: "Duplicate task",
      idempotencyKey: "task_fresh:create"
    })).rejects.toThrow("idempotency key is already in progress");
  });
});

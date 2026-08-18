import { describe, expect, it, vi } from "vitest";
import { ClickUpClient } from "../adapters/clickup/client.js";
import { MemoryIdempotencyStore } from "../adapters/clickup/idempotency.js";
import { BoundedAsyncQueue } from "../adapters/clickup/queue.js";
import { ClickUpMissionControl } from "../adapters/clickup/mission-control.js";
import type { MissionControlConfig, MissionControlLane } from "../adapters/clickup/mission-control.js";

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

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers
    }
  });
}

function makeControl(fetchFn: typeof fetch, maxRetries = 0): ClickUpMissionControl {
  return new ClickUpMissionControl({
    client: new ClickUpClient({ token: "pk_test", fetchFn, maxRetries }),
    config,
    idempotencyStore: new MemoryIdempotencyStore(() => "2026-08-18T03:00:00.000Z"),
    queue: new BoundedAsyncQueue({ concurrency: 1, maxPending: 4 })
  });
}

describe("ClickUpMissionControl", () => {
  it("deduplicates completed create writes and routes them only to the configured lane", async () => {
    let requestedUrl = "";
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return jsonResponse({ id: "cu-1", url: "https://app.clickup.com/t/cu-1" });
    });
    const control = makeControl(fetchFn as typeof fetch);

    const first = await control.createWorkItem({
      lane: "command_queue",
      name: "Execute governed work",
      description: "Task-scoped work only",
      idempotencyKey: "task_123:create"
    });
    const duplicate = await control.createWorkItem({
      lane: "command_queue",
      name: "Execute governed work",
      description: "Task-scoped work only",
      idempotencyKey: "task_123:create"
    });

    expect(duplicate).toEqual(first);
    expect(first).toEqual({
      action: "created",
      taskId: "cu-1",
      taskUrl: "https://app.clickup.com/t/cu-1"
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(requestedUrl).toContain("/list/list-command/task");
  });

  it("rejects an unknown lane before making an HTTP request", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ id: "should-not-run" }));
    const control = makeControl(fetchFn as typeof fetch);

    await expect(control.createWorkItem({
      lane: "arbitrary-list" as MissionControlLane,
      name: "Forbidden destination",
      idempotencyKey: "task_124:create"
    })).rejects.toThrow("unknown Mission Control lane");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("requires an approval record reference for protected status transitions", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ id: "cu-2", url: "https://app.clickup.com/t/cu-2" }));
    const control = makeControl(fetchFn as typeof fetch);

    await expect(control.updateWorkItem({
      taskId: "cu-2",
      status: "complete",
      idempotencyKey: "task_125:complete"
    })).rejects.toThrow("approval record reference required");
    expect(fetchFn).not.toHaveBeenCalled();

    await expect(control.updateWorkItem({
      taskId: "cu-2",
      status: "complete",
      approvalRecordReference: "approval_ABC123",
      idempotencyKey: "task_125:complete"
    })).resolves.toMatchObject({ action: "updated", taskId: "cu-2" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("releases a failed idempotency key so an explicit retry can succeed", async () => {
    const responses = [
      jsonResponse({ error: "temporary" }, 500),
      jsonResponse({ id: "cu-3", url: "https://app.clickup.com/t/cu-3" })
    ];
    const fetchFn = vi.fn(async () => responses.shift()!);
    const control = makeControl(fetchFn as typeof fetch, 0);
    const input = {
      lane: "runtime_agent_work" as const,
      name: "Retryable upstream work",
      idempotencyKey: "task_126:create"
    };

    await expect(control.createWorkItem(input)).rejects.toMatchObject({ status: 500 });
    await expect(control.createWorkItem(input)).resolves.toMatchObject({ action: "created", taskId: "cu-3" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("supports task reads and idempotent comments without exposing arbitrary destinations", async () => {
    const responses = [
      jsonResponse({ id: "cu-4", name: "Observed task" }),
      jsonResponse({ id: 98765 })
    ];
    let lastRequestedUrl = "";
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      lastRequestedUrl = String(input);
      return responses.shift()!;
    });
    const control = makeControl(fetchFn as typeof fetch);

    await expect(control.getTask("cu-4")).resolves.toMatchObject({ id: "cu-4", name: "Observed task" });
    const comment = await control.addComment({
      taskId: "cu-4",
      commentText: "Evidence receipt attached",
      idempotencyKey: "task_127:comment:evidence"
    });

    expect(comment).toEqual({ action: "commented", taskId: "cu-4", commentId: "98765" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(lastRequestedUrl).toContain("/task/cu-4/comment");
  });

  it("reports queue and rate-limit health without credentials", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(
      { id: "cu-5" },
      200,
      {
        "x-ratelimit-limit": "100",
        "x-ratelimit-remaining": "77",
        "x-ratelimit-reset": "1893456000"
      }
    ));
    const control = makeControl(fetchFn as typeof fetch);

    await control.getTask("cu-5");
    expect(control.health()).toEqual({
      workspaceId: "workspace-test",
      queue: { active: 0, pending: 0 },
      rateLimit: { limit: 100, remaining: 77, resetAtMs: 1_893_456_000_000 },
      lastError: null
    });
    expect(JSON.stringify(control.health())).not.toContain("pk_test");
  });
});

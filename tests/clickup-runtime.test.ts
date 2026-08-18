import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createClickUpMissionControlFromEnvironment,
  loadMissionControlConfig
} from "../adapters/clickup/runtime.js";
import type { MissionControlConfig } from "../adapters/clickup/mission-control.js";

const temporaryDirectories: string[] = [];

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

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ClickUp runtime activation", () => {
  it("loads and validates the committed Mission Control lane map", async () => {
    const directory = await mkdtemp(join(tmpdir(), "buildgraph-clickup-config-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "clickup.json");
    await writeFile(path, JSON.stringify({ ...config, folderId: "folder-test" }), "utf8");

    await expect(loadMissionControlConfig(path)).resolves.toEqual(config);
  });

  it("fails closed when credentials are missing or the workspace does not match", () => {
    expect(() => createClickUpMissionControlFromEnvironment({
      config,
      env: { CLICKUP_WORKSPACE_ID: "workspace-test" }
    })).toThrow("CLICKUP_API_TOKEN is required");

    expect(() => createClickUpMissionControlFromEnvironment({
      config,
      env: {
        CLICKUP_API_TOKEN: "pk_test",
        CLICKUP_WORKSPACE_ID: "wrong-workspace"
      }
    })).toThrow("does not match Mission Control config");
  });

  it("builds a runtime and verifies authenticated user plus workspace access without a write", async () => {
    const requestedUrls: string[] = [];
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith("/user")) {
        return new Response(JSON.stringify({ user: { id: 123, username: "Nic" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ spaces: [{ id: "space-1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    const control = createClickUpMissionControlFromEnvironment({
      config,
      env: {
        CLICKUP_API_TOKEN: "pk_test",
        CLICKUP_WORKSPACE_ID: "workspace-test",
        BUILDGRAPH_CLICKUP_IDEMPOTENCY_PATH: ".runtime/test-clickup-idempotency.json"
      },
      fetchFn: fetchFn as typeof fetch
    });

    await expect(control.verifyConnection()).resolves.toEqual({
      authorized: true,
      userId: "123",
      workspaceId: "workspace-test",
      spaceCount: 1
    });
    expect(requestedUrls).toEqual([
      "https://api.clickup.com/api/v2/user",
      "https://api.clickup.com/api/v2/team/workspace-test/space?archived=false"
    ]);
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runClickUpVerification } from "../scripts/clickup-verify.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ClickUp verification command", () => {
  it("performs only the read-only connection checks and returns a safe summary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "buildgraph-clickup-verify-"));
    temporaryDirectories.push(directory);
    const configPath = join(directory, "clickup.json");
    await writeFile(configPath, JSON.stringify({
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
    }), "utf8");

    const requests: Array<{ url: string; method?: string }> = [];
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, method: init?.method });
      if (url.endsWith("/user")) {
        return new Response(JSON.stringify({ user: { id: 42 } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ spaces: [{ id: "space-1" }, { id: "space-2" }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    await expect(runClickUpVerification({
      configPath,
      env: {
        CLICKUP_API_TOKEN: "pk_test_secret",
        CLICKUP_WORKSPACE_ID: "workspace-test"
      },
      fetchFn: fetchFn as typeof fetch
    })).resolves.toEqual({
      authorized: true,
      userId: "42",
      workspaceId: "workspace-test",
      spaceCount: 2
    });

    expect(requests).toEqual([
      { url: "https://api.clickup.com/api/v2/user", method: "GET" },
      { url: "https://api.clickup.com/api/v2/team/workspace-test/space?archived=false", method: "GET" }
    ]);
    expect(JSON.stringify(requests)).not.toContain("pk_test_secret");
  });
});

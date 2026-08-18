import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCanonicalRouterState, routeCapability } from "../../router/capability-router.js";

const registryRoot = resolve(import.meta.dirname, "..", "..", "registry");

const baseRequest = {
  taskId: "task_router001",
  traceId: "trace_router001",
  idempotencyKey: "buildgraph-core:router001:GKE-06:v0.1.0",
  projectId: "buildgraph-core",
  objective: "Produce an evidence-backed research synthesis with source verification and explicit uncertainty.",
  riskTier: "moderate" as const,
  requiredSkills: ["SKL-006"],
  requestedIntegrations: ["INT-019"],
  dataClassifications: ["public", "internal"],
  killSwitches: { writes_enabled: true, control_plane_available: true },
  hardStopAt: "2026-08-18T00:00:00Z"
};

describe("capability router", () => {
  it("routes a bounded research objective using canonical role, runtime, skill, and integration records", () => {
    const state = loadCanonicalRouterState(registryRoot);
    const decision = routeCapability(baseRequest, state);

    expect(decision.status).toBe("ROUTED");
    expect(decision.selectedRole?.id).toBe("GKE-06");
    expect(decision.selectedRuntime?.id).toBe("manus");
    expect(decision.assembledSkills).toContain("SKL-006");
    expect(decision.allowedIntegrations).toEqual([
      { id: "INT-019", scopeRef: "int-019/task-scoped", maxTier: "I1" }
    ]);
    expect(decision.taskEnvelope?.spec.authority.maximum_integration_tier).toBe("I1");
    expect(decision.agentPassport?.spec.authority_ceiling).toBe("I1");
  });

  it("fails closed when a required kill switch is false or unknown", () => {
    const state = loadCanonicalRouterState(registryRoot);
    const falseDecision = routeCapability({ ...baseRequest, killSwitches: { writes_enabled: false } }, state);
    const unknownDecision = routeCapability({ ...baseRequest, killSwitches: { writes_enabled: "unknown" } }, state);

    expect(falseDecision.status).toBe("BLOCKED");
    expect(falseDecision.reason[0]).toContain("writes_enabled");
    expect(unknownDecision.status).toBe("BLOCKED");
    expect(unknownDecision.reason[0]).toContain("unknown");
  });

  it("fails closed when a requested integration is not approved for the selected role", () => {
    const state = loadCanonicalRouterState(registryRoot);
    const decision = routeCapability({ ...baseRequest, requestedIntegrations: ["INT-007"] }, state);

    expect(decision.status).toBe("BLOCKED");
    expect(decision.reason[0]).toContain("requested integrations");
  });
});

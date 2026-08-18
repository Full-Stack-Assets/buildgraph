import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cursorAdapter } from "../adapters/cursor/index.js";
import { githubAdapter } from "../adapters/github/index.js";
import { manusAdapter } from "../adapters/manus/index.js";
import { openaiAdapter } from "../adapters/openai/index.js";
import type { AgentPassport, RuntimeReceipt, TaskEnvelope } from "../adapters/core.js";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const fixtureDirectory = resolve(root, "fixtures", "envelopes");

function loadFixture<T>(name: string): T {
  return parse(readFileSync(resolve(fixtureDirectory, name), "utf8")) as T;
}

const rawReceipt: RuntimeReceipt = {
  execution_status: "SUCCEEDED",
  outputs: [
    {
      artifact_id: "artifact_buildgraph.research-brief:runtime-output-v1",
      type: "cited-research-brief",
      uri: "artifacts/runtime-output-v1.md"
    }
  ],
  provenance: {
    tools: ["scoped-research"],
    source_ids: ["source_architecture_doc_v1"],
    workflow_version: "0.1.0"
  },
  quality_evidence: [
    {
      gate_id: "citation-complete",
      status: "needs_review",
      evidence_ref: "evidence/citation-review-v1"
    }
  ],
  risks_and_uncertainties: [],
  required_human_decision: null,
  next_handoff: {
    target_role_or_owner: "GKE-05",
    required_inputs: ["research brief"]
  },
  metrics: {
    latency_ms: 100,
    cost_unit: "test"
  }
};

describe("controlled runtime adapters", () => {
  it("projects a task only within the bound Manus passport and normalizes the receipt", () => {
    const task = loadFixture<TaskEnvelope>("valid-task-envelope.yaml");
    const passport = loadFixture<AgentPassport>("valid-agent-passport.yaml");

    const projection = manusAdapter.compile(task, passport);
    const result = manusAdapter.normalize(task, passport, rawReceipt, "2026-08-17T00:10:00Z");

    expect(projection.runtime_id).toBe("manus");
    expect(projection.allowed_integration_scopes).toEqual(passport.spec.allowed_integration_scopes);
    expect(projection.prohibited_actions).toContain("production deployment");
    expect(result.metadata.agent_instance_id).toBe(passport.metadata.agent_instance_id);
    expect(result.spec.status).toBe("NEEDS_REVIEW");
  });

  it("rejects authority above the BuildGraph v0 I2 boundary", () => {
    const task = loadFixture<TaskEnvelope>("valid-task-envelope.yaml");
    const passport = loadFixture<AgentPassport>("valid-agent-passport.yaml");
    const elevatedPassport: AgentPassport = structuredClone(passport);
    elevatedPassport.spec.authority_ceiling = "I3";

    expect(() => manusAdapter.compile(task, elevatedPassport)).toThrow("BuildGraph v0 passports reject authority above I2");
  });

  it("declares controlled adapters for all initially supported runtimes", () => {
    expect(manusAdapter.capability.runtime_id).toBe("manus");
    expect(openaiAdapter.capability.runtime_id).toBe("openai");
    expect(cursorAdapter.capability.runtime_id).toBe("cursor");
    expect(githubAdapter.capability.runtime_id).toBe("github");
    expect(cursorAdapter.capability.supports_pull_request_creation).toBe(true);
    expect(githubAdapter.capability.maximum_supported_tier).toBe("I2");
  });
});

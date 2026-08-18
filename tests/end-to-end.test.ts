import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { manusAdapter } from "../adapters/manus/index.js";
import type { AgentPassport, RuntimeReceipt, TaskEnvelope } from "../adapters/core.js";
import { registerBuildGraphFormats } from "../scripts/ajv-formats.js";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const fixturesDirectory = resolve(root, "fixtures", "envelopes");
const schemasDirectory = resolve(root, "schemas");

function loadYaml<T>(path: string): T {
  return parse(readFileSync(path, "utf8")) as T;
}

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(schemasDirectory, name), "utf8")) as Record<string, unknown>;
}

describe("BuildGraph v0 end-to-end control path", () => {
  it("keeps authority bounded and produces a valid normalized result receipt", () => {
    const task = loadYaml<TaskEnvelope>(resolve(fixturesDirectory, "valid-task-envelope.yaml"));
    const passport = loadYaml<AgentPassport>(resolve(fixturesDirectory, "valid-agent-passport.yaml"));
    const receipt: RuntimeReceipt = {
      execution_status: "SUCCEEDED",
      outputs: [
        {
          artifact_id: "artifact_buildgraph.research-brief:e2e-output-v1",
          type: "cited-research-brief",
          uri: "artifacts/e2e-output-v1.md",
          summary: "E2E controlled research receipt."
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
          evidence_ref: "evidence/e2e-citation-review-v1"
        }
      ],
      risks_and_uncertainties: [],
      required_human_decision: null,
      next_handoff: {
        target_role_or_owner: "GKE-05",
        required_inputs: ["cited research brief"]
      },
      metrics: {
        latency_ms: 75,
        cost_unit: "test"
      }
    };

    const projection = manusAdapter.compile(task, passport);
    const result = manusAdapter.normalize(task, passport, receipt, "2026-08-17T00:20:00Z");
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    registerBuildGraphFormats(ajv);
    ajv.addSchema(loadSchema("common.schema.json"));
    ajv.addSchema(loadSchema("result-envelope.schema.json"));
    const resultSchema = ajv.getSchema("https://buildgraph.local/schemas/result-envelope.schema.json");

    expect(projection.allowed_integration_scopes[0]?.max_tier).toBe("I1");
    expect(projection.prohibited_actions).toContain("payment or financial action");
    expect(result.spec.status).toBe("NEEDS_REVIEW");
    expect(resultSchema?.(result)).toBe(true);
  });
});

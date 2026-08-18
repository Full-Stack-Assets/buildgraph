import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { registerBuildGraphFormats } from "../scripts/ajv-formats.js";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const schemasDirectory = resolve(root, "schemas");
const fixturesDirectory = resolve(root, "fixtures", "envelopes");

const schemaByKind: Record<string, string> = {
  TaskEnvelope: "task-envelope.schema.json",
  ResultEnvelope: "result-envelope.schema.json",
  AgentPassport: "agent-passport.schema.json",
  ApprovalRecord: "approval-record.schema.json"
};

function loadJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function loadYaml(path: string): Record<string, unknown> {
  return parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function createValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  registerBuildGraphFormats(ajv);
  const schemaNames = ["common.schema.json", ...Object.values(schemaByKind)];

  for (const schemaName of schemaNames) {
    ajv.addSchema(loadJson(resolve(schemasDirectory, schemaName)));
  }

  return ajv;
}

function validateFixture(ajv: Ajv2020, fixtureName: string) {
  const fixture = loadYaml(resolve(fixturesDirectory, fixtureName));
  const kind = fixture.kind;
  const schemaName = typeof kind === "string" ? schemaByKind[kind] : undefined;

  expect(schemaName).toBeDefined();
  const schema = ajv.getSchema(`https://buildgraph.local/schemas/${schemaName}`);
  expect(schema).toBeDefined();

  return schema?.(fixture) ?? false;
}

describe("task-scoped control contracts", () => {
  it("accepts complete task, result, passport, and approval fixtures", () => {
    const ajv = createValidator();

    expect(validateFixture(ajv, "valid-task-envelope.yaml")).toBe(true);
    expect(validateFixture(ajv, "valid-result-envelope.yaml")).toBe(true);
    expect(validateFixture(ajv, "valid-agent-passport.yaml")).toBe(true);
    expect(validateFixture(ajv, "valid-approval-record.yaml")).toBe(true);
  });

  it("rejects a task envelope with no objective", () => {
    const ajv = createValidator();

    expect(validateFixture(ajv, "invalid-task-envelope.yaml")).toBe(false);
  });
});

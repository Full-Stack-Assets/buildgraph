import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { compileGraph, validateGraph } from "../graph/compiler.js";

const root = resolve(import.meta.dirname, "..");
const registryRoot = resolve(root, "registry");

function loadYaml(path: string): Record<string, unknown> {
  return parse(readFileSync(resolve(root, path), "utf8")) as Record<string, unknown>;
}

describe("AOC canonical architecture v1", () => {
  it("publishes the canonical specification, runtime contract, ADR, and reconciliation evidence", () => {
    for (const path of [
      "docs/architecture/AGENT_OPERATING_COMPANY_CANONICAL_ARCHITECTURE.md",
      "docs/architecture/RUNTIME_ADAPTER_CONTRACT_V1.md",
      "docs/architecture/AOC_ONTOLOGY_V1.json",
      "docs/architecture/EXISTING_LIBRARY_RECONCILIATION_MATRIX.md",
      "docs/architecture/EXISTING_LIBRARY_RECONCILIATION_MATRIX.csv",
      "docs/adr/ADR-002-aoc-canonical-architecture-v1.md"
    ]) {
      expect(existsSync(resolve(root, path)), `${path} must exist`).toBe(true);
    }
    const matrixRows = readFileSync(resolve(root, "docs/architecture/EXISTING_LIBRARY_RECONCILIATION_MATRIX.csv"), "utf8")
      .trim()
      .split("\n");
    expect(matrixRows).toHaveLength(199);
  });

  it("defines every first-class canonical entity and a controlled relationship vocabulary", () => {
    const requiredSchemas = [
      "organization", "division", "product", "capability", "agent-definition", "agent-instance", "factory",
      "work-order", "execution-run", "tool", "provider", "evidence", "verification", "artifact", "decision", "constraint"
    ];

    for (const name of requiredSchemas) {
      expect(existsSync(resolve(root, `schemas/${name}-spec.schema.json`)), `${name} schema must exist`).toBe(true);
    }

    const relationshipSchema = JSON.parse(readFileSync(resolve(root, "schemas/relationship-type.schema.json"), "utf8")) as {
      enum: string[];
    };
    const ontology = JSON.parse(readFileSync(resolve(root, "docs/architecture/AOC_ONTOLOGY_V1.json"), "utf8")) as {
      entity_types: string[];
      relationship_types: string[];
    };
    expect(relationshipSchema.enum).toEqual(expect.arrayContaining([
      "owns", "requires", "provides", "implements", "instantiates", "uses", "supports", "produces", "validates", "governed_by"
    ]));
    expect(ontology.entity_types).toHaveLength(24);
    expect([...ontology.relationship_types].sort()).toEqual([...relationshipSchema.enum].sort());
  });

  it("registers the exact ten permanent divisions under one organization", () => {
    const expected = [
      "Command & Orchestration",
      "Canon, Intelligence & Research",
      "Product & Software Engineering",
      "Automation & Agent Engineering",
      "Data, Analytics & Operational Intelligence",
      "Creative Media Production",
      "Release, Distribution & Compliance",
      "Audience, Growth, Sales & Partnerships",
      "Commercial Learning, Finance & Optimization",
      "Independent Verification, Security & Governance"
    ];
    const divisionDirectory = resolve(registryRoot, "divisions");
    const divisions = readdirSync(divisionDirectory)
      .filter((path) => path.endsWith(".yaml"))
      .map((path) => loadYaml(`registry/divisions/${path}`)) as Array<{ metadata?: { name?: string } }>;
    const organization = loadYaml("registry/organizations/agent-operating-company.yaml") as {
      spec?: { division_ids?: string[] };
    };

    expect(divisions.map((division) => division.metadata?.name).sort()).toEqual(expected.sort());
    expect(organization.spec?.division_ids).toHaveLength(10);
  });

  it("registers capability-centered and portable runtime profiles", () => {
    const capabilities = readdirSync(resolve(registryRoot, "capabilities")).filter((path) => path.endsWith(".yaml"));
    const runtimeProfiles = readdirSync(resolve(registryRoot, "runtimes"))
      .filter((path) => path.endsWith(".yaml"))
      .map((path) => loadYaml(`registry/runtimes/${path}`) as {
        metadata?: { id?: string };
        spec?: { contract?: Record<string, unknown> };
      });
    const runtimeIds = runtimeProfiles.map((profile) => profile.metadata?.id);

    expect(capabilities).toHaveLength(13);
    expect(runtimeIds).toEqual(expect.arrayContaining(["openai", "cursor", "manus", "github", "gemini", "grok", "claude", "codex", "local"]));
    for (const profile of runtimeProfiles) {
      expect(profile.spec?.contract?.runtime_id).toBe(profile.metadata?.id);
      expect(profile.spec?.contract).toEqual(expect.objectContaining({
        supported_models: expect.any(Array),
        supported_tools: expect.any(Array),
        supports_mcp: expect.any(Boolean),
        supports_files: expect.any(Boolean),
        supports_repo_context: expect.any(Boolean),
        supports_structured_output: expect.any(Boolean),
        permission_model: expect.any(String),
        context_limits: expect.any(Object),
        artifact_support: expect.any(Array),
        authentication_model: expect.any(String),
        known_constraints: expect.any(Array),
        evidence_state: expect.any(String)
      }));
    }
  });

  it("compiles the expanded registry without relationship compatibility errors", () => {
    const graph = compileGraph(registryRoot);
    const report = validateGraph(graph);
    const types = new Set(graph.entities.map((entity) => entity.type));

    for (const type of [
      "Organization", "Division", "Product", "Capability", "AgentDefinition", "AgentInstance", "Factory", "WorkOrder",
      "ExecutionRun", "Tool", "Provider", "Evidence", "Verification", "Artifact", "Decision", "Constraint"
    ]) {
      expect(types.has(type), `${type} must be a first-class graph entity`).toBe(true);
    }
    expect(report.valid).toBe(true);
    expect(report.errors.some((issue) => issue.code === "INVALID_RELATIONSHIP_COMPATIBILITY")).toBe(false);
  });
});

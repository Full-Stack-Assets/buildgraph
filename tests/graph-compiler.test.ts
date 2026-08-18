import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compileGraph, preflightGraph, validateGraph, writeGraphOutputs, type BuildGraph } from "../graph/compiler.js";

const registryRoot = resolve(import.meta.dirname, "..", "registry");

describe("Unit 15-E canonical graph compiler", () => {
  it("compiles the local registry deterministically with typed provenance-carrying relationship edges", () => {
    const first = compileGraph(registryRoot);
    const second = compileGraph(registryRoot);
    const role = first.entities.find((entity) => entity.id === "role:gke-06");
    const skillEdge = first.edges.find((edge) => edge.source === "role:gke-06" && edge.target === "skill:skl-006");

    expect(first.content_hash).toBe(second.content_hash);
    expect(first.entities.length).toBeGreaterThan(30);
    expect(role?.metadata.declared_state).toBe("canonical_manifest");
    expect(skillEdge?.type).toBe("requires");
    expect(skillEdge?.provenance.source_uri).toContain("registry/roles/");
  });

  it("validates the generated graph and reports intentional dangling relationships as blocking errors", () => {
    const graph = compileGraph(registryRoot);
    const validReport = validateGraph(graph);
    const invalidGraph: BuildGraph = structuredClone(graph);
    invalidGraph.edges.push({
      id: "edge:00000000000000000000",
      source: "role:gke-06",
      target: "skill:missing",
      type: "requires",
      provenance: { collector: "test", source_uri: "tests/graph-compiler.test.ts", confidence: 100 }
    });
    invalidGraph.content_hash = graph.content_hash;
    const invalidReport = validateGraph(invalidGraph);

    expect(validReport.valid).toBe(true);
    expect(invalidReport.valid).toBe(false);
    expect(invalidReport.errors.some((issue) => issue.code === "DANGLING_EDGE_TARGET")).toBe(true);
  });

  it("returns deterministic preflight reuse decisions and writes portable graph outputs", () => {
    const graph = compileGraph(registryRoot);
    const role = graph.entities.find((entity) => entity.type === "Role");
    const outputRoot = mkdtempSync(resolve(tmpdir(), "buildgraph-15e-"));

    try {
      const preflight = preflightGraph(graph, role?.canonical_name ?? "", "Role");
      const report = validateGraph(graph);
      const paths = writeGraphOutputs(graph, report, outputRoot);

      expect(preflight.decision).toBe("REUSE_EXISTING");
      expect(preflight.matches[0]?.id).toBe(role?.id);
      expect(existsSync(paths.graph)).toBe(true);
      expect(existsSync(paths.entities)).toBe(true);
      expect(existsSync(paths.edges)).toBe(true);
      expect(existsSync(paths.validation)).toBe(true);
      expect(JSON.parse(readFileSync(paths.graph, "utf8")).content_hash).toBe(graph.content_hash);
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });
});

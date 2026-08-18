import { resolve } from "node:path";
import { compileGraph, validateGraph, writeGraphOutputs } from "../graph/compiler.js";

const root = resolve(import.meta.dirname, "..");
const registryRoot = resolve(process.env.BUILDGRAPH_REGISTRY_DIR ?? resolve(root, "registry"));
const outputRoot = resolve(process.env.BUILDGRAPH_OUTPUT_DIR ?? resolve(root, "generated", "buildgraph"));

const graph = compileGraph(registryRoot);
const report = validateGraph(graph);
const outputs = writeGraphOutputs(graph, report, outputRoot);

if (!report.valid) {
  console.error(JSON.stringify({ report, outputs }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ graph: graph.summary, content_hash: graph.content_hash, report, outputs }, null, 2));

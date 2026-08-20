import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileGraph, preflightGraph, validateGraph, type PreflightRequest } from "../graph/compiler.js";

const root = resolve(import.meta.dirname, "..");
const registryRoot = resolve(process.env.BUILDGRAPH_REGISTRY_DIR ?? resolve(root, "registry"));
const fileIndex = process.argv.indexOf("--file");
const inlineIndex = process.argv.indexOf("--request");

function readRequest(): PreflightRequest {
  if (fileIndex >= 0 && process.argv[fileIndex + 1]) {
    return JSON.parse(readFileSync(resolve(process.cwd(), process.argv[fileIndex + 1]), "utf8")) as PreflightRequest;
  }
  if (inlineIndex >= 0 && process.argv[inlineIndex + 1]) {
    return JSON.parse(process.argv[inlineIndex + 1]) as PreflightRequest;
  }
  if (!process.stdin.isTTY) {
    return JSON.parse(readFileSync(0, "utf8")) as PreflightRequest;
  }
  throw new Error("Provide a JSON request with --file, --request, or stdin.");
}

const graph = compileGraph(registryRoot);
const report = validateGraph(graph);

if (!report.valid) {
  console.error(JSON.stringify({ error: "canonical graph validation failed", report }, null, 2));
  process.exit(1);
}

const result = preflightGraph(graph, readRequest());
console.log(JSON.stringify(result, null, 2));

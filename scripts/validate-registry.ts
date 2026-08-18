import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse } from "yaml";

type Manifest = {
  kind?: string;
  metadata?: { id?: string };
};

const root = resolve(import.meta.dirname, "..");
const schemaDirectory = resolve(root, "schemas");
const registryDirectory = resolve(process.env.BUILDGRAPH_REGISTRY_DIR ?? resolve(root, "registry"));

const schemaByKind: Record<string, string> = {
  PortfolioSpec: "portfolio-spec.schema.json",
  ProjectSpec: "project-spec.schema.json",
  RoleSpec: "role-spec.schema.json",
  SkillSpec: "skill-spec.schema.json",
  IntegrationSpec: "integration-spec.schema.json",
  PolicySpec: "policy-spec.schema.json",
  WorkflowSpec: "workflow-spec.schema.json",
  RuntimeAdapter: "runtime-adapter.schema.json"
};

function listFiles(directory: string, predicate: (path: string) => boolean): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      return listFiles(path, predicate);
    }

    return predicate(path) ? [path] : [];
  });
}

function loadYaml(path: string): Manifest {
  const content = readFileSync(path, "utf8");
  const manifest = parse(content) as Manifest | null;

  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`${path}: manifest must be a YAML object`);
  }

  return manifest;
}

function formatErrors(errors: unknown): string {
  if (!Array.isArray(errors)) {
    return "unknown schema validation error";
  }

  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "failed validation"}`)
    .join("; ");
}

const ajv = new Ajv2020({ allErrors: true, strict: true });

for (const schemaPath of listFiles(schemaDirectory, (path) => path.endsWith(".schema.json"))) {
  ajv.addSchema(JSON.parse(readFileSync(schemaPath, "utf8")));
}

const manifestPaths = listFiles(registryDirectory, (path) => path.endsWith(".yaml") || path.endsWith(".yml"));
const errors: string[] = [];

for (const manifestPath of manifestPaths) {
  try {
    const manifest = loadYaml(manifestPath);
    const schemaName = manifest.kind ? schemaByKind[manifest.kind] : undefined;

    if (!schemaName) {
      errors.push(`${manifestPath}: unsupported or missing manifest kind`);
      continue;
    }

    const schema = ajv.getSchema(`https://buildgraph.local/schemas/${schemaName}`);

    if (!schema) {
      errors.push(`${manifestPath}: schema ${schemaName} is not registered`);
      continue;
    }

    if (!schema(manifest)) {
      errors.push(`${manifestPath}: ${formatErrors(schema.errors)}`);
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : `${manifestPath}: unable to load manifest`);
  }
}

if (errors.length > 0) {
  console.error("BuildGraph registry validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`BuildGraph registry validation passed for ${manifestPaths.length} manifest(s).`);

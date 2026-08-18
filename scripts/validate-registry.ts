import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse } from "yaml";

type Manifest = {
  kind?: string;
  metadata?: { id?: string };
  spec?: Record<string, unknown>;
};

type LoadedManifest = {
  path: string;
  manifest: Manifest;
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

const tierScore: Record<string, number> = { I0: 0, I1: 1, I2: 2, I3: 3, I4: 4 };

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

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asReferenceIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (typeof item === "object" && item !== null && "id" in item) {
      const id = (item as { id?: unknown }).id;
      return typeof id === "string" ? [id] : [];
    }

    return [];
  });
}

function asTier(value: unknown): number | undefined {
  return typeof value === "string" ? tierScore[value] : undefined;
}

const ajv = new Ajv2020({ allErrors: true, strict: true });

for (const schemaPath of listFiles(schemaDirectory, (path) => path.endsWith(".schema.json"))) {
  ajv.addSchema(JSON.parse(readFileSync(schemaPath, "utf8")));
}

const manifestPaths = listFiles(registryDirectory, (path) => path.endsWith(".yaml") || path.endsWith(".yml"));
const errors: string[] = [];
const loaded: LoadedManifest[] = [];

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
      continue;
    }

    loaded.push({ path: manifestPath, manifest });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : `${manifestPath}: unable to load manifest`);
  }
}

const manifestsByKind = new Map<string, Map<string, LoadedManifest>>();

for (const entry of loaded) {
  const kind = entry.manifest.kind;
  const id = entry.manifest.metadata?.id;

  if (!kind || !id) {
    continue;
  }

  const manifests = manifestsByKind.get(kind) ?? new Map<string, LoadedManifest>();

  if (manifests.has(id)) {
    errors.push(`${entry.path}: duplicate ${kind} ID ${id}`);
  }

  manifests.set(id, entry);
  manifestsByKind.set(kind, manifests);
}

function hasManifest(kind: string, id: string): boolean {
  return manifestsByKind.get(kind)?.has(id) ?? false;
}

for (const entry of loaded) {
  const { manifest, path } = entry;
  const spec = manifest.spec ?? {};

  if (manifest.kind === "RoleSpec") {
    const roleId = manifest.metadata?.id ?? "unknown-role";
    const authority = asTier(spec.authority_ceiling);

    for (const skillId of asReferenceIds(spec.skills)) {
      if (!hasManifest("SkillSpec", skillId)) {
        errors.push(`${path}: role ${roleId} references missing skill ${skillId}`);
      }
    }

    for (const integrationReference of Array.isArray(spec.integrations) ? spec.integrations : []) {
      if (typeof integrationReference !== "object" || integrationReference === null) {
        continue;
      }

      const reference = integrationReference as { id?: unknown; max_tier?: unknown };
      const integrationId = typeof reference.id === "string" ? reference.id : "unknown-integration";
      const requestedTier = asTier(reference.max_tier);
      const integration = manifestsByKind.get("IntegrationSpec")?.get(integrationId);

      if (!integration) {
        errors.push(`${path}: role ${roleId} references missing integration ${integrationId}`);
        continue;
      }

      const integrationTier = asTier(integration.manifest.spec?.permission_tier);

      if (requestedTier === undefined || authority === undefined || integrationTier === undefined) {
        errors.push(`${path}: role ${roleId} has unresolved authority tier for ${integrationId}`);
        continue;
      }

      if (requestedTier > authority) {
        errors.push(`${path}: role ${roleId} requests ${reference.max_tier} above role authority ceiling`);
      }

      if (requestedTier > integrationTier) {
        errors.push(`${path}: role ${roleId} requests ${reference.max_tier} above integration ${integrationId} permission tier`);
      }
    }
  }

  if (manifest.kind === "IntegrationSpec") {
    for (const roleId of asStringArray(spec.approved_roles)) {
      if (!hasManifest("RoleSpec", roleId)) {
        errors.push(`${path}: integration references missing approved role ${roleId}`);
      }
    }
  }

  if (manifest.kind === "PortfolioSpec") {
    for (const projectId of asStringArray(spec.project_ids)) {
      if (!hasManifest("ProjectSpec", projectId)) {
        errors.push(`${path}: portfolio references missing project ${projectId}`);
      }
    }

    for (const policyId of asStringArray(spec.default_policy_refs)) {
      if (!hasManifest("PolicySpec", policyId)) {
        errors.push(`${path}: portfolio references missing policy ${policyId}`);
      }
    }
  }

  if (manifest.kind === "ProjectSpec") {
    const portfolioId = typeof spec.portfolio_id === "string" ? spec.portfolio_id : "unknown-portfolio";
    const authority = spec.authority as { approval_policy_ref?: unknown } | undefined;
    const policyId = typeof authority?.approval_policy_ref === "string" ? authority.approval_policy_ref : "unknown-policy";

    if (!hasManifest("PortfolioSpec", portfolioId)) {
      errors.push(`${path}: project references missing portfolio ${portfolioId}`);
    }

    if (!hasManifest("PolicySpec", policyId)) {
      errors.push(`${path}: project references missing approval policy ${policyId}`);
    }
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

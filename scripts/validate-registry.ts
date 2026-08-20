import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { registerBuildGraphFormats } from "./ajv-formats.js";
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
  RuntimeAdapter: "runtime-adapter.schema.json",
  OrganizationSpec: "organization-spec.schema.json",
  DivisionSpec: "division-spec.schema.json",
  ProductSpec: "product-spec.schema.json",
  CapabilitySpec: "capability-spec.schema.json",
  AgentDefinitionSpec: "agent-definition-spec.schema.json",
  AgentInstanceSpec: "agent-instance-spec.schema.json",
  FactorySpec: "factory-spec.schema.json",
  WorkOrderSpec: "work-order-spec.schema.json",
  ExecutionRunSpec: "execution-run-spec.schema.json",
  ToolSpec: "tool-spec.schema.json",
  ProviderSpec: "provider-spec.schema.json",
  EvidenceSpec: "evidence-spec.schema.json",
  VerificationSpec: "verification-spec.schema.json",
  ArtifactSpec: "artifact-spec.schema.json",
  DecisionSpec: "decision-spec.schema.json",
  ConstraintSpec: "constraint-spec.schema.json"
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

type CrossReferenceRule = {
  path: string;
  targetKind: string;
  shape?: "single" | "strings" | "objects";
  objectKey?: string;
};

const crossReferenceRules: Record<string, CrossReferenceRule[]> = {
  ProjectSpec: [
    { path: "capability_ids", targetKind: "CapabilitySpec" },
    { path: "factory_ids", targetKind: "FactorySpec" },
    { path: "canonical_role_ids", targetKind: "RoleSpec" },
    { path: "project_specific_role_ids", targetKind: "RoleSpec" },
    { path: "policy_ids", targetKind: "PolicySpec" },
    { path: "runtime_preferences", targetKind: "RuntimeAdapter" }
  ],
  RuntimeAdapter: [
    { path: "contract.supported_tools", targetKind: "ToolSpec" },
    { path: "contract.supported_agent_definition_ids", targetKind: "AgentDefinitionSpec" }
  ],
  OrganizationSpec: [
    { path: "division_ids", targetKind: "DivisionSpec" },
    { path: "product_ids", targetKind: "ProductSpec" }
  ],
  DivisionSpec: [
    { path: "organization_id", targetKind: "OrganizationSpec", shape: "single" },
    { path: "role_definition_ids", targetKind: "RoleSpec" },
    { path: "capability_ids", targetKind: "CapabilitySpec" },
    { path: "product_ids", targetKind: "ProductSpec" }
  ],
  ProductSpec: [
    { path: "organization_id", targetKind: "OrganizationSpec", shape: "single" },
    { path: "home_division_id", targetKind: "DivisionSpec", shape: "single" },
    { path: "capability_ids", targetKind: "CapabilitySpec" },
    { path: "project_ids", targetKind: "ProjectSpec" }
  ],
  CapabilitySpec: [
    { path: "home_division_id", targetKind: "DivisionSpec", shape: "single" },
    { path: "provider_role_ids", targetKind: "RoleSpec" },
    { path: "implementing_skill_ids", targetKind: "SkillSpec" },
    { path: "required_tool_ids", targetKind: "ToolSpec" },
    { path: "runtime_support", targetKind: "RuntimeAdapter", shape: "objects", objectKey: "runtime_id" }
  ],
  AgentDefinitionSpec: [
    { path: "role_definition_ids", targetKind: "RoleSpec" },
    { path: "skill_ids", targetKind: "SkillSpec" },
    { path: "capability_ids", targetKind: "CapabilitySpec" },
    { path: "tool_ids", targetKind: "ToolSpec" },
    { path: "policies", targetKind: "PolicySpec" }
  ],
  AgentInstanceSpec: [
    { path: "agent_definition_id", targetKind: "AgentDefinitionSpec", shape: "single" },
    { path: "runtime_id", targetKind: "RuntimeAdapter", shape: "single" },
    { path: "tool_ids", targetKind: "ToolSpec" },
    { path: "integration_ids", targetKind: "IntegrationSpec" }
  ],
  FactorySpec: [
    { path: "workflow_ids", targetKind: "WorkflowSpec" },
    { path: "role_definition_ids", targetKind: "RoleSpec" },
    { path: "capability_ids", targetKind: "CapabilitySpec" }
  ],
  WorkOrderSpec: [
    { path: "project_id", targetKind: "ProjectSpec", shape: "single" },
    { path: "factory_id", targetKind: "FactorySpec", shape: "single" },
    { path: "required_capability_ids", targetKind: "CapabilitySpec" },
    { path: "agent_definition_ids", targetKind: "AgentDefinitionSpec" },
    { path: "policy_ids", targetKind: "PolicySpec" }
  ],
  ExecutionRunSpec: [
    { path: "work_order_id", targetKind: "WorkOrderSpec", shape: "single" },
    { path: "agent_instance_id", targetKind: "AgentInstanceSpec", shape: "single" },
    { path: "runtime_id", targetKind: "RuntimeAdapter", shape: "single" },
    { path: "artifact_ids", targetKind: "ArtifactSpec" },
    { path: "evidence_ids", targetKind: "EvidenceSpec" }
  ],
  ToolSpec: [
    { path: "provider_id", targetKind: "ProviderSpec", shape: "single" },
    { path: "integration_id", targetKind: "IntegrationSpec", shape: "single" }
  ],
  ProviderSpec: [
    { path: "runtime_ids", targetKind: "RuntimeAdapter" },
    { path: "tool_ids", targetKind: "ToolSpec" }
  ],
  EvidenceSpec: [
    { path: "capability_ids", targetKind: "CapabilitySpec" },
    { path: "artifact_ids", targetKind: "ArtifactSpec" },
    { path: "execution_run_id", targetKind: "ExecutionRunSpec", shape: "single" }
  ],
  VerificationSpec: [
    { path: "evidence_ids", targetKind: "EvidenceSpec" },
    { path: "artifact_ids", targetKind: "ArtifactSpec" },
    { path: "capability_ids", targetKind: "CapabilitySpec" }
  ],
  ArtifactSpec: [{ path: "execution_run_id", targetKind: "ExecutionRunSpec", shape: "single" }],
  DecisionSpec: [
    { path: "project_id", targetKind: "ProjectSpec", shape: "single" },
    { path: "policy_ids", targetKind: "PolicySpec" }
  ],
  ConstraintSpec: [
    { path: "policy_ids", targetKind: "PolicySpec" },
    { path: "organization_ids", targetKind: "OrganizationSpec" },
    { path: "division_ids", targetKind: "DivisionSpec" },
    { path: "product_ids", targetKind: "ProductSpec" },
    { path: "project_ids", targetKind: "ProjectSpec" },
    { path: "agent_definition_ids", targetKind: "AgentDefinitionSpec" },
    { path: "runtime_ids", targetKind: "RuntimeAdapter" }
  ]
};

function valueAtPath(value: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    return typeof current === "object" && current !== null
      ? (current as Record<string, unknown>)[segment]
      : undefined;
  }, value);
}

function referenceValues(raw: unknown, rule: CrossReferenceRule): string[] {
  if (rule.shape === "single") {
    return typeof raw === "string" ? [raw] : [];
  }
  if (rule.shape === "objects") {
    if (!Array.isArray(raw)) return [];
    const key = rule.objectKey ?? "id";
    return raw.flatMap((item) => {
      const value = typeof item === "object" && item !== null ? (item as Record<string, unknown>)[key] : undefined;
      return typeof value === "string" ? [value] : [];
    });
  }
  return asStringArray(raw);
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
registerBuildGraphFormats(ajv);

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
  const kind = entry.manifest.kind;
  if (!kind) continue;
  for (const rule of crossReferenceRules[kind] ?? []) {
    const raw = valueAtPath(entry.manifest.spec ?? {}, rule.path);
    for (const referenceId of referenceValues(raw, rule)) {
      if (!hasManifest(rule.targetKind, referenceId)) {
        errors.push(`${entry.path}: ${kind} references missing ${rule.targetKind} ${referenceId} at ${rule.path}`);
      }
    }
  }
  if (kind === "RuntimeAdapter") {
    const runtimeId = entry.manifest.metadata?.id;
    const contractRuntimeId = valueAtPath(entry.manifest.spec ?? {}, "contract.runtime_id");
    if (runtimeId !== contractRuntimeId) {
      errors.push(`${entry.path}: RuntimeAdapter metadata.id must equal spec.contract.runtime_id`);
    }
  }
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

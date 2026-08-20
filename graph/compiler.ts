import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parse } from "yaml";
import { isCompatibleRelationship } from "./ontology.js";

const SCHEMA_VERSION = "buildgraph/1.0";
const DETERMINISTIC_TIME = "1970-01-01T00:00:00Z";

export type Provenance = {
  collector: string;
  source_uri: string;
  confidence: number;
};

export type GraphEntity = {
  id: string;
  canonical_name: string;
  type: string;
  version: string;
  status: string;
  source: string;
  source_uri: string;
  created_at: string;
  updated_at: string;
  provenance: Provenance;
  confidence: number;
  tags: string[];
  metadata: Record<string, unknown>;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  provenance: Provenance;
};

export type GraphIssue = {
  code: string;
  severity: "error" | "warning";
  object_id?: string;
  field?: string;
  message: string;
  blocking: boolean;
};

export type BuildGraph = {
  schema_version: string;
  generated_at: string;
  source_root: string;
  summary: {
    total_entities: number;
    total_edges: number;
    entity_counts: Record<string, number>;
    conflict_count: number;
  };
  entities: GraphEntity[];
  edges: GraphEdge[];
  conflicts: GraphIssue[];
  content_hash: string;
};

export type GraphValidationReport = {
  schema_version: string;
  valid: boolean;
  error_count: number;
  warning_count: number;
  errors: GraphIssue[];
  warnings: GraphIssue[];
  counts: BuildGraph["summary"];
};

export type PreflightRequest = {
  name: string;
  purpose?: string;
  entity_type?: string;
  capabilities?: string[];
  technologies?: string[];
  features?: string[];
  justification?: string;
};

export type PreflightSimilarity = {
  purpose: number;
  capabilities: number;
  technology: number;
  features: number;
  overall: number;
};

export type PreflightMatch = {
  id: string;
  canonical_name: string;
  type: string;
  score: number;
  similarity: PreflightSimilarity;
  source_uri: string;
};

export type PreflightResult = {
  decision: "REUSE_EXISTING" | "EXTEND_EXISTING" | "CREATE_NEW";
  justification: string;
  evidence: string[];
  payload_hash: string;
  matches: PreflightMatch[];
  closest_projects: PreflightMatch[];
  similarity: PreflightSimilarity;
  overlap: string[];
  gaps: string[];
  reusable_assets: string[];
  waste_risk: { score: number; level: "low" | "moderate" | "high" };
  create_new_requires_justification: boolean;
};

type Manifest = {
  api_version?: string;
  kind?: string;
  metadata?: { id?: string; name?: string; version?: string; status?: string; owner?: string };
  spec?: Record<string, unknown>;
};

export const typeByKind: Record<string, string> = {
  PortfolioSpec: "Portfolio",
  ProjectSpec: "Project",
  RoleSpec: "Role",
  SkillSpec: "Skill",
  IntegrationSpec: "Integration",
  PolicySpec: "Policy",
  WorkflowSpec: "Workflow",
  RuntimeAdapter: "Runtime",
  OrganizationSpec: "Organization",
  DivisionSpec: "Division",
  ProductSpec: "Product",
  CapabilitySpec: "Capability",
  AgentDefinitionSpec: "AgentDefinition",
  AgentInstanceSpec: "AgentInstance",
  FactorySpec: "Factory",
  WorkOrderSpec: "WorkOrder",
  ExecutionRunSpec: "ExecutionRun",
  ToolSpec: "Tool",
  ProviderSpec: "Provider",
  EvidenceSpec: "Evidence",
  VerificationSpec: "Verification",
  ArtifactSpec: "Artifact",
  DecisionSpec: "Decision",
  ConstraintSpec: "Constraint"
};

type ReferenceRule = {
  path: string;
  targetType: string;
  relationship: string;
  shape?: "strings" | "objects" | "single";
  reverse?: boolean;
};

const referenceRulesByKind: Record<string, ReferenceRule[]> = {
  PortfolioSpec: [
    { path: "project_ids", targetType: "Project", relationship: "contains" },
    { path: "default_policy_refs", targetType: "Policy", relationship: "governed_by" }
  ],
  ProjectSpec: [
    { path: "portfolio_id", targetType: "Portfolio", relationship: "belongs_to", shape: "single" },
    { path: "authority.approval_policy_ref", targetType: "Policy", relationship: "governed_by", shape: "single" },
    { path: "capability_ids", targetType: "Capability", relationship: "uses" },
    { path: "factory_ids", targetType: "Factory", relationship: "uses" },
    { path: "canonical_role_ids", targetType: "Role", relationship: "uses" },
    { path: "project_specific_role_ids", targetType: "Role", relationship: "uses" },
    { path: "policy_ids", targetType: "Policy", relationship: "governed_by" },
    { path: "runtime_preferences", targetType: "Runtime", relationship: "uses" }
  ],
  RoleSpec: [
    { path: "skills", targetType: "Skill", relationship: "requires", shape: "objects" },
    { path: "integrations", targetType: "Integration", relationship: "uses", shape: "objects" },
    { path: "capability_ids", targetType: "Capability", relationship: "provides" }
  ],
  IntegrationSpec: [{ path: "approved_roles", targetType: "Role", relationship: "authorizes" }],
  WorkflowSpec: [
    { path: "roles", targetType: "Role", relationship: "uses" },
    { path: "skills", targetType: "Skill", relationship: "requires" },
    { path: "capability_ids", targetType: "Capability", relationship: "requires" },
    { path: "integrations", targetType: "Integration", relationship: "uses" },
    { path: "policies", targetType: "Policy", relationship: "governed_by" }
  ],
  RuntimeAdapter: [
    { path: "contract.supported_agent_definition_ids", targetType: "AgentDefinition", relationship: "supports" }
  ],
  OrganizationSpec: [
    { path: "division_ids", targetType: "Division", relationship: "contains" },
    { path: "product_ids", targetType: "Product", relationship: "owns" }
  ],
  DivisionSpec: [
    { path: "organization_id", targetType: "Organization", relationship: "belongs_to", shape: "single" },
    { path: "role_definition_ids", targetType: "Role", relationship: "owns" },
    { path: "capability_ids", targetType: "Capability", relationship: "owns" },
    { path: "product_ids", targetType: "Product", relationship: "owns" }
  ],
  ProductSpec: [
    { path: "organization_id", targetType: "Organization", relationship: "belongs_to", shape: "single" },
    { path: "home_division_id", targetType: "Division", relationship: "belongs_to", shape: "single" },
    { path: "capability_ids", targetType: "Capability", relationship: "uses" },
    { path: "project_ids", targetType: "Project", relationship: "contains" }
  ],
  CapabilitySpec: [
    { path: "home_division_id", targetType: "Division", relationship: "belongs_to", shape: "single" },
    { path: "provider_role_ids", targetType: "Role", relationship: "provides", reverse: true },
    { path: "implementing_skill_ids", targetType: "Skill", relationship: "implements", reverse: true },
    { path: "required_tool_ids", targetType: "Tool", relationship: "uses" }
  ],
  AgentDefinitionSpec: [
    { path: "role_definition_ids", targetType: "Role", relationship: "instantiates" },
    { path: "skill_ids", targetType: "Skill", relationship: "uses" },
    { path: "capability_ids", targetType: "Capability", relationship: "provides" },
    { path: "tool_ids", targetType: "Tool", relationship: "uses" }
  ],
  AgentInstanceSpec: [
    { path: "agent_definition_id", targetType: "AgentDefinition", relationship: "instantiates", shape: "single" },
    { path: "runtime_id", targetType: "Runtime", relationship: "uses", shape: "single" },
    { path: "tool_ids", targetType: "Tool", relationship: "uses" },
    { path: "integration_ids", targetType: "Integration", relationship: "uses" }
  ],
  FactorySpec: [
    { path: "workflow_ids", targetType: "Workflow", relationship: "uses" },
    { path: "role_definition_ids", targetType: "Role", relationship: "uses" },
    { path: "capability_ids", targetType: "Capability", relationship: "requires" }
  ],
  WorkOrderSpec: [
    { path: "project_id", targetType: "Project", relationship: "belongs_to", shape: "single" },
    { path: "factory_id", targetType: "Factory", relationship: "uses", shape: "single" },
    { path: "agent_definition_ids", targetType: "AgentDefinition", relationship: "uses" },
    { path: "required_capability_ids", targetType: "Capability", relationship: "requires" },
    { path: "policy_ids", targetType: "Policy", relationship: "governed_by" }
  ],
  ExecutionRunSpec: [
    { path: "work_order_id", targetType: "WorkOrder", relationship: "executes", shape: "single" },
    { path: "agent_instance_id", targetType: "AgentInstance", relationship: "uses", shape: "single" },
    { path: "runtime_id", targetType: "Runtime", relationship: "uses", shape: "single" },
    { path: "artifact_ids", targetType: "Artifact", relationship: "produces" },
    { path: "evidence_ids", targetType: "Evidence", relationship: "produces" }
  ],
  ToolSpec: [
    { path: "provider_id", targetType: "Provider", relationship: "supplied_by", shape: "single" },
    { path: "integration_id", targetType: "Integration", relationship: "uses", shape: "single" }
  ],
  ProviderSpec: [
    { path: "runtime_ids", targetType: "Runtime", relationship: "supports" },
    { path: "tool_ids", targetType: "Tool", relationship: "provides" }
  ],
  EvidenceSpec: [
    { path: "capability_ids", targetType: "Capability", relationship: "validates" },
    { path: "artifact_ids", targetType: "Artifact", relationship: "validates" },
    { path: "execution_run_id", targetType: "ExecutionRun", relationship: "belongs_to", shape: "single" }
  ],
  VerificationSpec: [
    { path: "evidence_ids", targetType: "Evidence", relationship: "validates" },
    { path: "artifact_ids", targetType: "Artifact", relationship: "validates" },
    { path: "capability_ids", targetType: "Capability", relationship: "validates" }
  ],
  ArtifactSpec: [
    { path: "execution_run_id", targetType: "ExecutionRun", relationship: "belongs_to", shape: "single" }
  ],
  DecisionSpec: [
    { path: "project_id", targetType: "Project", relationship: "belongs_to", shape: "single" },
    { path: "policy_ids", targetType: "Policy", relationship: "governed_by" }
  ],
  ConstraintSpec: [
    { path: "policy_ids", targetType: "Policy", relationship: "governed_by" },
    { path: "organization_ids", targetType: "Organization", relationship: "governs" },
    { path: "division_ids", targetType: "Division", relationship: "governs" },
    { path: "product_ids", targetType: "Product", relationship: "governs" },
    { path: "project_ids", targetType: "Project", relationship: "governs" },
    { path: "agent_definition_ids", targetType: "AgentDefinition", relationship: "governs" },
    { path: "runtime_ids", targetType: "Runtime", relationship: "governs" }
  ]
};

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(",")}}`;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function graphId(type: string, sourceId: string): string {
  return `${slug(type)}:${slug(sourceId)}`;
}

function listYamlFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? listYamlFiles(path) : path.endsWith(".yaml") || path.endsWith(".yml") ? [path] : [];
    })
    .sort();
}

function loadManifest(path: string): Manifest {
  const parsed = parse(readFileSync(path, "utf8")) as Manifest | null;

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Manifest is not a YAML object: ${path}`);
  }

  return parsed;
}

function sourceUri(registryRoot: string, path: string): string {
  return `registry/${relative(registryRoot, path).replaceAll("\\", "/")}`;
}

function makeEntity(kind: string, manifest: Manifest, path: string, registryRoot: string): GraphEntity {
  const sourceId = manifest.metadata?.id;
  const type = typeByKind[kind];

  if (!sourceId || !type) {
    throw new Error(`Cannot create graph entity from manifest at ${path}`);
  }

  const uri = sourceUri(registryRoot, path);
  const digest = sha256(readFileSync(path));
  const status = manifest.metadata?.status ?? "unknown";
  const owner = manifest.metadata?.owner;
  const spec = manifest.spec ?? {};
  const capabilities = [
    ...asStringArray(spec.capability_ids),
    ...asStringArray(spec.required_capability_ids),
    ...asStringArray(spec.provided_capability_ids),
    ...(typeof spec.code === "string" ? [spec.code] : [])
  ];
  const technologies = [
    ...asStringArray(spec.technologies),
    ...asStringArray(spec.runtime_preferences),
    ...asStringArray(spec.supported_tools)
  ];
  const features = [
    kind,
    type,
    ...asStringArray(spec.features),
    ...asStringArray(spec.entity_types)
  ];
  const purpose =
    typeof spec.purpose === "string"
      ? spec.purpose
      : typeof spec.mission === "string"
        ? spec.mission
        : manifest.metadata?.name ?? sourceId;

  return {
    id: graphId(type, sourceId),
    canonical_name: manifest.metadata?.name ?? sourceId,
    type,
    version: manifest.metadata?.version ?? "0.1.0",
    status,
    source: "canonical-registry",
    source_uri: uri,
    created_at: DETERMINISTIC_TIME,
    updated_at: DETERMINISTIC_TIME,
    provenance: { collector: "buildgraph-15-e", source_uri: uri, confidence: 100 },
    confidence: 100,
    tags: [slug(type), slug(status)].filter(Boolean).sort(),
    metadata: {
      kind,
      canonical_manifest_id: sourceId,
      owner: owner ?? null,
      manifest_sha256: digest,
      declared_state: "canonical_manifest",
      purpose,
      capabilities: [...new Set(capabilities)].sort(),
      technologies: [...new Set(technologies)].sort(),
      features: [...new Set(features)].sort()
    }
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asObjectIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (typeof item === "object" && item !== null && "id" in item) {
      const id = (item as { id?: unknown }).id;
      return typeof id === "string" ? [id] : [];
    }
    return typeof item === "string" ? [item] : [];
  });
}

function valueAtPath(value: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    return typeof current === "object" && current !== null
      ? (current as Record<string, unknown>)[segment]
      : undefined;
  }, value);
}

function edgeId(source: string, target: string, type: string, uri: string): string {
  return `edge:${sha256(`${source}|${type}|${target}|${uri}`).slice(0, 20)}`;
}

function makeEdge(source: string, target: string, type: string, uri: string): GraphEdge {
  return {
    id: edgeId(source, target, type, uri),
    source,
    target,
    type,
    provenance: { collector: "buildgraph-15-e", source_uri: uri, confidence: 100 }
  };
}

function createReferenceEdges(kind: string, entity: GraphEntity, manifest: Manifest): GraphEdge[] {
  const spec = manifest.spec ?? {};
  const rules = referenceRulesByKind[kind] ?? [];
  const edges: GraphEdge[] = [];

  for (const rule of rules) {
    const raw = valueAtPath(spec, rule.path);
    const referenceIds =
      rule.shape === "single"
        ? typeof raw === "string"
          ? [raw]
          : []
        : rule.shape === "objects"
          ? asObjectIdArray(raw)
          : asStringArray(raw);
    for (const referenceId of referenceIds) {
      const referencedEntityId = graphId(rule.targetType, referenceId);
      edges.push(
        rule.reverse
          ? makeEdge(referencedEntityId, entity.id, rule.relationship, entity.source_uri)
          : makeEdge(entity.id, referencedEntityId, rule.relationship, entity.source_uri)
      );
    }
  }

  return edges;
}

function makePlaceholder(targetId: string, sourceUriValue: string, referencedBy: string): GraphEntity {
  const [prefix, rawId] = targetId.split(":", 2);
  const type = prefix ? prefix[0]?.toUpperCase() + prefix.slice(1) : "Concept";

  return {
    id: targetId,
    canonical_name: rawId ?? targetId,
    type,
    version: "0.0.0",
    status: "unresolved",
    source: "reference-closure",
    source_uri: sourceUriValue,
    created_at: DETERMINISTIC_TIME,
    updated_at: DETERMINISTIC_TIME,
    provenance: { collector: "buildgraph-15-e", source_uri: sourceUriValue, confidence: 0 },
    confidence: 0,
    tags: ["placeholder", "unresolved"],
    metadata: { placeholder: true, unresolved_reference: true, referenced_by_edge: referencedBy }
  };
}

export function compileGraph(registryRoot: string): BuildGraph {
  const entities: GraphEntity[] = [];
  const edges: GraphEdge[] = [];
  const conflicts: GraphIssue[] = [];

  for (const path of listYamlFiles(registryRoot)) {
    const manifest = loadManifest(path);
    const kind = manifest.kind;

    if (!kind || !typeByKind[kind] || !manifest.metadata?.id) {
      continue;
    }

    const entity = makeEntity(kind, manifest, path, registryRoot);
    entities.push(entity);
    edges.push(...createReferenceEdges(kind, entity, manifest));
  }

  const entityById = new Map<string, GraphEntity>();
  for (const entity of entities.sort((left, right) => left.id.localeCompare(right.id))) {
    const existing = entityById.get(entity.id);
    if (existing && stableJson(existing) !== stableJson(entity)) {
      conflicts.push({
        code: "DUPLICATE_ENTITY_ID",
        severity: "warning",
        object_id: entity.id,
        message: `Conflicting source entity retained from ${existing.source_uri}; duplicate from ${entity.source_uri} recorded.`,
        blocking: false
      });
      continue;
    }
    entityById.set(entity.id, entity);
  }

  for (const edge of edges) {
    if (!entityById.has(edge.source)) {
      entityById.set(edge.source, makePlaceholder(edge.source, edge.provenance.source_uri, edge.id));
    }
    if (!entityById.has(edge.target)) {
      entityById.set(edge.target, makePlaceholder(edge.target, edge.provenance.source_uri, edge.id));
    }
  }

  const deduplicatedEdges = new Map<string, GraphEdge>();
  for (const edge of edges) {
    deduplicatedEdges.set(edge.id, edge);
  }

  const orderedEntities = [...entityById.values()].sort((left, right) => left.id.localeCompare(right.id));
  const orderedEdges = [...deduplicatedEdges.values()].sort((left, right) => left.id.localeCompare(right.id));
  const entityCounts = orderedEntities.reduce<Record<string, number>>((counts, entity) => {
    counts[entity.type] = (counts[entity.type] ?? 0) + 1;
    return counts;
  }, {});
  const graphWithoutHash = {
    schema_version: SCHEMA_VERSION,
    generated_at: DETERMINISTIC_TIME,
    source_root: "registry/",
    summary: {
      total_entities: orderedEntities.length,
      total_edges: orderedEdges.length,
      entity_counts: Object.fromEntries(Object.entries(entityCounts).sort(([left], [right]) => left.localeCompare(right))),
      conflict_count: conflicts.length
    },
    entities: orderedEntities,
    edges: orderedEdges,
    conflicts: conflicts.sort((left, right) => (left.object_id ?? "").localeCompare(right.object_id ?? ""))
  };

  return { ...graphWithoutHash, content_hash: sha256(stableJson(graphWithoutHash)) };
}

export function validateGraph(graph: BuildGraph): GraphValidationReport {
  const errors: GraphIssue[] = [];
  const warnings: GraphIssue[] = [];
  const entityIds = new Set<string>();
  const entitiesById = new Map<string, GraphEntity>();
  const edgeIds = new Set<string>();
  const requiredEntityFields: Array<keyof GraphEntity> = ["id", "canonical_name", "type", "version", "status", "source", "source_uri", "created_at", "updated_at", "provenance", "confidence", "tags", "metadata"];

  for (const entity of graph.entities) {
    const missing = requiredEntityFields.filter((field) => entity[field] === undefined || entity[field] === null || entity[field] === "");
    if (missing.length > 0) {
      errors.push({ code: "MISSING_REQUIRED_FIELDS", severity: "error", object_id: entity.id, field: missing.join(","), message: `Entity is missing required fields: ${missing.join(", ")}.`, blocking: true });
    }
    if (entityIds.has(entity.id)) {
      errors.push({ code: "DUPLICATE_ENTITY_ID", severity: "error", object_id: entity.id, message: "Entity ID appears more than once.", blocking: true });
    }
    entityIds.add(entity.id);
    entitiesById.set(entity.id, entity);
    if (entity.metadata.unresolved_reference === true) {
      warnings.push({ code: "UNRESOLVED_REFERENCE", severity: "warning", object_id: entity.id, message: "Graph contains an explicit unresolved placeholder.", blocking: false });
    }
  }

  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      errors.push({ code: "DUPLICATE_EDGE_ID", severity: "error", object_id: edge.id, message: "Edge ID appears more than once.", blocking: true });
    }
    edgeIds.add(edge.id);
    if (!entityIds.has(edge.source)) {
      errors.push({ code: "DANGLING_EDGE_SOURCE", severity: "error", object_id: edge.id, field: "source", message: `Edge source ${edge.source} is not a graph entity.`, blocking: true });
    }
    if (!entityIds.has(edge.target)) {
      errors.push({ code: "DANGLING_EDGE_TARGET", severity: "error", object_id: edge.id, field: "target", message: `Edge target ${edge.target} is not a graph entity.`, blocking: true });
    }
    const sourceEntity = entitiesById.get(edge.source);
    const targetEntity = entitiesById.get(edge.target);
    if (
      sourceEntity &&
      targetEntity &&
      sourceEntity.metadata.placeholder !== true &&
      targetEntity.metadata.placeholder !== true &&
      !isCompatibleRelationship(sourceEntity.type, edge.type, targetEntity.type)
    ) {
      errors.push({
        code: "INVALID_RELATIONSHIP_COMPATIBILITY",
        severity: "error",
        object_id: edge.id,
        field: "type",
        message: `${sourceEntity.type} ${edge.type} ${targetEntity.type} is not allowed by the canonical relationship vocabulary.`,
        blocking: true
      });
    }
  }

  const graphWithoutHash = { ...graph };
  delete (graphWithoutHash as Partial<BuildGraph>).content_hash;
  const expectedHash = sha256(stableJson(graphWithoutHash));
  if (graph.content_hash !== expectedHash) {
    errors.push({ code: "CONTENT_HASH_MISMATCH", severity: "error", field: "content_hash", message: "Graph content hash does not match its deterministic serialized content.", blocking: true });
  }

  return {
    schema_version: SCHEMA_VERSION,
    valid: errors.length === 0,
    error_count: errors.length,
    warning_count: warnings.length,
    errors,
    warnings,
    counts: graph.summary
  };
}

const STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "be", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "with"
]);

function tokens(value: unknown): Set<string> {
  const text = Array.isArray(value) ? value.join(" ") : typeof value === "string" ? value : "";
  const expanded = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLocaleLowerCase();
  return new Set(
    (expanded.match(/[a-z0-9]+/g) ?? [])
      .map((token) => (token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token))
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
  );
}

function similarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return Number((intersection / union).toFixed(4));
}

function stringMetadata(entity: GraphEntity, field: string): string[] {
  const value = entity.metadata[field];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function expandedCapabilities(graph: BuildGraph, entity: GraphEntity): string[] {
  const values = new Set(stringMetadata(entity, "capabilities"));
  const entitiesById = new Map(graph.entities.map((candidate) => [candidate.id, candidate]));
  for (const edge of graph.edges) {
    if (edge.source !== entity.id || !["uses", "provides", "requires", "owns"].includes(edge.type)) continue;
    const target = entitiesById.get(edge.target);
    if (target?.type !== "Capability") continue;
    values.add(String(target.metadata.canonical_manifest_id ?? target.canonical_name));
    for (const code of stringMetadata(target, "capabilities")) values.add(code);
  }
  return [...values];
}

function scoreEntity(graph: BuildGraph, entity: GraphEntity, request: PreflightRequest): PreflightMatch {
  const purposeScore = similarity(
    tokens([request.name, request.purpose ?? ""]),
    tokens([entity.canonical_name, typeof entity.metadata.purpose === "string" ? entity.metadata.purpose : ""])
  );
  const capabilityScore = similarity(tokens(request.capabilities ?? []), tokens(expandedCapabilities(graph, entity)));
  const technologyScore = similarity(tokens(request.technologies ?? []), tokens(stringMetadata(entity, "technologies")));
  const featureScore = similarity(tokens(request.features ?? []), tokens(stringMetadata(entity, "features")));
  const exact = entity.canonical_name.toLocaleLowerCase() === request.name.trim().toLocaleLowerCase();
  const overall = exact
    ? 1
    : Number((purposeScore * 0.6 + capabilityScore * 0.2 + technologyScore * 0.1 + featureScore * 0.1).toFixed(4));
  return {
    id: entity.id,
    canonical_name: entity.canonical_name,
    type: entity.type,
    score: overall,
    similarity: {
      purpose: exact ? 1 : purposeScore,
      capabilities: capabilityScore,
      technology: technologyScore,
      features: featureScore,
      overall
    },
    source_uri: entity.source_uri
  };
}

function rankEntities(graph: BuildGraph, request: PreflightRequest, entityType?: string): PreflightMatch[] {
  return graph.entities
    .filter((entity) => entity.status !== "unresolved" && (!entityType || entity.type === entityType))
    .map((entity) => scoreEntity(graph, entity, request))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, 10);
}

function riskFor(decision: PreflightResult["decision"], topScore: number): PreflightResult["waste_risk"] {
  const score =
    decision === "REUSE_EXISTING"
      ? 100
      : decision === "EXTEND_EXISTING"
        ? Math.max(50, Math.round(topScore * 100))
        : Math.round(topScore * 100);
  return { score, level: score >= 75 ? "high" : score >= 35 ? "moderate" : "low" };
}

export function preflightGraph(graph: BuildGraph, query: string | PreflightRequest, entityType?: string): PreflightResult {
  const request: PreflightRequest =
    typeof query === "string" ? { name: query, entity_type: entityType } : structuredClone(query);
  const requestedType = entityType ?? request.entity_type;
  const matches = rankEntities(graph, request, requestedType);
  const closestProjects = rankEntities(graph, request, "Project");
  const exact = matches.find(
    (match) => match.canonical_name.toLocaleLowerCase() === request.name.trim().toLocaleLowerCase()
  );
  const top = exact ?? matches[0];
  const decision: PreflightResult["decision"] = exact
    ? "REUSE_EXISTING"
    : top && top.score >= 0.1
      ? "EXTEND_EXISTING"
      : "CREATE_NEW";
  const similarityResult = top?.similarity ?? {
    purpose: 0,
    capabilities: 0,
    technology: 0,
    features: 0,
    overall: 0
  };
  const overlap = ([
    similarityResult.purpose > 0 ? "purpose" : null,
    similarityResult.capabilities > 0 ? "capabilities" : null,
    similarityResult.technology > 0 ? "technology" : null,
    similarityResult.features > 0 ? "features" : null
  ].filter(Boolean) as string[]);
  const gaps = ["purpose", "capabilities", "technology", "features"].filter((dimension) => !overlap.includes(dimension));
  const evidence = [
    `graph:${graph.content_hash}`,
    `graph-schema:${graph.schema_version}`,
    ...matches.slice(0, 3).flatMap((match) => [match.id, match.source_uri])
  ];
  const justification =
    decision === "REUSE_EXISTING"
      ? `Reuse ${exact?.id ?? "the existing entity"} because the deterministic graph contains an exact canonical match.`
      : decision === "EXTEND_EXISTING"
        ? `Extend ${top?.id ?? "the closest BuildGraph entity"} because the proposal overlaps the existing canonical graph while introducing material gaps in ${gaps.join(", ") || "implementation detail"}.`
        : "Create a new entity only after recording why no sufficiently similar canonical entity can be reused or extended.";

  return {
    decision,
    justification,
    evidence: [...new Set(evidence)],
    payload_hash: sha256(stableJson(request)),
    matches,
    closest_projects: closestProjects,
    similarity: similarityResult,
    overlap,
    gaps,
    reusable_assets: matches.slice(0, 5).map((match) => match.source_uri),
    waste_risk: riskFor(decision, top?.score ?? 0),
    create_new_requires_justification: decision === "CREATE_NEW"
  };
}

export function writeGraphOutputs(graph: BuildGraph, report: GraphValidationReport, outputRoot: string): Record<string, string> {
  const entitiesDirectory = resolve(outputRoot, "entities");
  const edgesDirectory = resolve(outputRoot, "edges");
  const validationDirectory = resolve(outputRoot, "validation");
  const snapshotsDirectory = resolve(outputRoot, "snapshots");
  for (const directory of [outputRoot, entitiesDirectory, edgesDirectory, validationDirectory, snapshotsDirectory]) {
    mkdirSync(directory, { recursive: true });
  }

  const paths = {
    graph: resolve(outputRoot, "buildgraph.json"),
    entities: resolve(entitiesDirectory, "entities.jsonl"),
    edges: resolve(edgesDirectory, "edges.jsonl"),
    validation: resolve(validationDirectory, "report.json"),
    snapshot: resolve(snapshotsDirectory, `snapshot-${graph.content_hash.slice(0, 12)}.json`)
  };
  writeFileSync(paths.graph, `${stableJson(graph)}\n`, "utf8");
  writeFileSync(paths.entities, graph.entities.map((entity) => stableJson(entity)).join("\n") + "\n", "utf8");
  writeFileSync(paths.edges, graph.edges.map((edge) => stableJson(edge)).join("\n") + "\n", "utf8");
  writeFileSync(paths.validation, `${stableJson(report)}\n`, "utf8");
  writeFileSync(paths.snapshot, `${stableJson({ content_hash: graph.content_hash, summary: graph.summary })}\n`, "utf8");
  return paths;
}

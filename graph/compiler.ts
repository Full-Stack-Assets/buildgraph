import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parse } from "yaml";

const SCHEMA_VERSION = "buildgraph/15-e.1";
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

type Manifest = {
  api_version?: string;
  kind?: string;
  metadata?: { id?: string; name?: string; version?: string; status?: string; owner?: string };
  spec?: Record<string, unknown>;
};

const typeByKind: Record<string, string> = {
  PortfolioSpec: "Portfolio",
  ProjectSpec: "Project",
  RoleSpec: "Role",
  SkillSpec: "Skill",
  IntegrationSpec: "Integration",
  PolicySpec: "Policy",
  WorkflowSpec: "Workflow",
  RuntimeAdapter: "Runtime"
};

const referenceTypeByKind: Record<string, Record<string, string>> = {
  PortfolioSpec: { project_ids: "Project", default_policy_refs: "Policy" },
  ProjectSpec: { portfolio_id: "Portfolio", approval_policy_ref: "Policy" },
  RoleSpec: { skills: "Skill", integrations: "Integration" },
  IntegrationSpec: { approved_roles: "Role" },
  WorkflowSpec: { roles: "Role", skills: "Skill", integrations: "Integration", policies: "Policy" }
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
      declared_state: "canonical_manifest"
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
  const mapping = referenceTypeByKind[kind] ?? {};
  const edges: GraphEdge[] = [];

  for (const [field, targetType] of Object.entries(mapping)) {
    const raw = spec[field];
    const sourceUriValue = entity.source_uri;
    const referenceIds = field === "skills" || field === "integrations" ? asObjectIdArray(raw) : asStringArray(raw);

    if (field === "portfolio_id" || field === "approval_policy_ref") {
      if (typeof raw === "string") {
        referenceIds.push(raw);
      }
    }

    for (const referenceId of referenceIds) {
      const relation = field === "approved_roles" ? "authorizes" : field === "skills" ? "requires" : field === "integrations" ? "uses" : field === "project_ids" ? "contains" : field === "portfolio_id" ? "belongs_to" : field === "default_policy_refs" || field === "approval_policy_ref" || field === "policies" ? "governed_by" : "references";
      edges.push(makeEdge(entity.id, graphId(targetType, referenceId), relation, sourceUriValue));
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

export function preflightGraph(graph: BuildGraph, query: string, entityType?: string): {
  decision: "REUSE_EXISTING" | "EXTEND_EXISTING" | "CREATE_NEW";
  matches: Array<{ id: string; canonical_name: string; type: string; score: number }>;
  create_new_requires_justification: boolean;
} {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const candidates = graph.entities.filter((entity) => !entityType || entity.type === entityType);
  const exact = candidates.filter((entity) => entity.canonical_name.toLocaleLowerCase() === normalizedQuery);

  if (exact.length > 0) {
    return {
      decision: "REUSE_EXISTING",
      matches: exact.map((entity) => ({ id: entity.id, canonical_name: entity.canonical_name, type: entity.type, score: 1 })),
      create_new_requires_justification: false
    };
  }

  const queryTokens = new Set(normalizedQuery.match(/[a-z0-9]+/g) ?? []);
  const matches = candidates
    .map((entity) => {
      const entityTokens = new Set(entity.canonical_name.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? []);
      const intersection = [...queryTokens].filter((token) => entityTokens.has(token)).length;
      const union = new Set([...queryTokens, ...entityTokens]).size;
      return { id: entity.id, canonical_name: entity.canonical_name, type: entity.type, score: union === 0 ? 0 : Number((intersection / union).toFixed(4)) };
    })
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, 10);

  const decision = matches[0] && matches[0].score >= 0.5 ? "EXTEND_EXISTING" : "CREATE_NEW";
  return { decision, matches, create_new_requires_justification: decision === "CREATE_NEW" };
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

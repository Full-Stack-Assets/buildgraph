import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import type { AgentPassport, IntegrationTier, TaskEnvelope } from "../adapters/core.js";

export type RouterRole = {
  id: string;
  version: string;
  status: "draft" | "pilot" | "approved" | "suspended" | "retired";
  mission: string;
  operatingClass: string;
  primaryDomain: string;
  riskTier: string;
  authorityCeiling: IntegrationTier;
  skills: string[];
  integrations: Array<{ id: string; maxTier: IntegrationTier }>;
  preferredRuntimes: string[];
  allowedRuntimes: string[];
  prohibitedRuntimes: string[];
};

export type RouterIntegration = {
  id: string;
  status: "proposed" | "sandbox" | "approved" | "suspended" | "retired";
  permissionTier: IntegrationTier;
  approvedRoles: string[];
};

export type RouterRuntime = {
  id: string;
  status: "draft" | "pilot" | "approved" | "suspended" | "retired";
  maximumSupportedTier: IntegrationTier;
};

export type RouteRequest = {
  taskId: string;
  traceId: string;
  idempotencyKey: string;
  projectId: string;
  objective: string;
  riskTier: "low" | "moderate" | "high" | "restricted";
  requiredSkills?: string[];
  preferredRuntime?: string;
  requestedIntegrations?: string[];
  dataClassifications: string[];
  killSwitches: Record<string, boolean | "unknown">;
  hardStopAt: string;
};

export type RouteDecision = {
  status: "ROUTED" | "BLOCKED";
  reason: string[];
  selectedRole?: RouterRole;
  selectedRuntime?: RouterRuntime;
  assembledSkills: string[];
  allowedIntegrations: Array<{ id: string; scopeRef: string; maxTier: IntegrationTier }>;
  taskEnvelope?: TaskEnvelope;
  agentPassport?: AgentPassport;
};

type Manifest = {
  kind?: string;
  metadata?: { id?: string; version?: string; status?: string };
  spec?: Record<string, unknown>;
};

const tierScore: Record<IntegrationTier, number> = { I0: 0, I1: 1, I2: 2, I3: 3, I4: 4 };

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : path.endsWith(".yaml") ? [path] : [];
  });
}

function loadManifest(path: string): Manifest {
  return parse(readFileSync(path, "utf8")) as Manifest;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asTier(value: unknown): IntegrationTier {
  if (typeof value !== "string" || !(value in tierScore)) {
    throw new Error("invalid integration tier in canonical registry");
  }

  return value as IntegrationTier;
}

function maxTier(left: IntegrationTier, right: IntegrationTier): IntegrationTier {
  return tierScore[left] >= tierScore[right] ? left : right;
}

function minTier(left: IntegrationTier, right: IntegrationTier): IntegrationTier {
  return tierScore[left] <= tierScore[right] ? left : right;
}

function roleMatchesObjective(role: RouterRole, objective: string): number {
  const corpus = `${role.mission} ${role.primaryDomain} ${role.operatingClass}`.toLowerCase();
  const tokens = objective.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
  return tokens.reduce((score, token) => (corpus.includes(token) ? score + 1 : score), 0);
}

function toRole(manifest: Manifest): RouterRole {
  const spec = manifest.spec ?? {};
  const compatibility = spec.runtime_compatibility as Record<string, unknown>;
  const skills = Array.isArray(spec.skills)
    ? spec.skills.flatMap((skill) => {
        const id = typeof skill === "object" && skill !== null ? (skill as { id?: unknown }).id : undefined;
        return typeof id === "string" ? [id] : [];
      })
    : [];
  const integrations = Array.isArray(spec.integrations)
    ? spec.integrations.flatMap((integration) => {
        if (typeof integration !== "object" || integration === null) {
          return [];
        }
        const value = integration as { id?: unknown; max_tier?: unknown };
        return typeof value.id === "string" ? [{ id: value.id, maxTier: asTier(value.max_tier) }] : [];
      })
    : [];

  return {
    id: String(manifest.metadata?.id),
    version: String(manifest.metadata?.version),
    status: manifest.metadata?.status as RouterRole["status"],
    mission: String(spec.mission),
    operatingClass: String(spec.operating_class),
    primaryDomain: String(spec.primary_domain),
    riskTier: String(spec.risk_tier),
    authorityCeiling: asTier(spec.authority_ceiling),
    skills,
    integrations,
    preferredRuntimes: asStringArray(compatibility.preferred),
    allowedRuntimes: asStringArray(compatibility.allowed),
    prohibitedRuntimes: asStringArray(compatibility.prohibited)
  };
}

function toIntegration(manifest: Manifest): RouterIntegration {
  const spec = manifest.spec ?? {};
  return {
    id: String(manifest.metadata?.id),
    status: manifest.metadata?.status as RouterIntegration["status"],
    permissionTier: asTier(spec.permission_tier),
    approvedRoles: asStringArray(spec.approved_roles)
  };
}

function toRuntime(manifest: Manifest): RouterRuntime {
  const spec = manifest.spec ?? {};
  const authority = spec.authority as Record<string, unknown>;
  return {
    id: String(manifest.metadata?.id),
    status: manifest.metadata?.status as RouterRuntime["status"],
    maximumSupportedTier: asTier(authority.maximum_supported_tier)
  };
}

export function loadCanonicalRouterState(registryRoot: string): {
  roles: RouterRole[];
  integrations: RouterIntegration[];
  runtimes: RouterRuntime[];
} {
  const manifests = listFiles(registryRoot).map(loadManifest);

  return {
    roles: manifests.filter((manifest) => manifest.kind === "RoleSpec").map(toRole),
    integrations: manifests.filter((manifest) => manifest.kind === "IntegrationSpec").map(toIntegration),
    runtimes: manifests.filter((manifest) => manifest.kind === "RuntimeAdapter").map(toRuntime)
  };
}

export function routeCapability(
  request: RouteRequest,
  state: ReturnType<typeof loadCanonicalRouterState>
): RouteDecision {
  const blockedSwitch = Object.entries(request.killSwitches).find(([, value]) => value !== true);

  if (blockedSwitch) {
    return {
      status: "BLOCKED",
      reason: [`kill switch ${blockedSwitch[0]} is ${String(blockedSwitch[1])}; routing fails closed`],
      assembledSkills: [],
      allowedIntegrations: []
    };
  }

  const candidates = state.roles
    .filter((role) => role.status === "pilot" || role.status === "approved")
    .filter((role) => tierScore[role.authorityCeiling] <= tierScore.I2)
    .filter((role) => request.requiredSkills?.every((skill) => role.skills.includes(skill)) ?? true)
    .map((role) => ({ role, score: roleMatchesObjective(role, request.objective) }))
    .sort((left, right) => right.score - left.score || left.role.id.localeCompare(right.role.id));

  const selectedRole = candidates[0]?.role;

  if (!selectedRole) {
    return {
      status: "BLOCKED",
      reason: ["no approved or pilot role satisfies the required skills and I0–I2 boundary"],
      assembledSkills: [],
      allowedIntegrations: []
    };
  }

  const runtimeOrder = [request.preferredRuntime, ...selectedRole.preferredRuntimes, ...selectedRole.allowedRuntimes]
    .filter((runtime): runtime is string => Boolean(runtime));
  const selectedRuntime = runtimeOrder
    .map((runtimeId) => state.runtimes.find((runtime) => runtime.id === runtimeId))
    .find(
      (runtime): runtime is RouterRuntime =>
        runtime !== undefined &&
        (runtime.status === "pilot" || runtime.status === "approved") &&
        !selectedRole.prohibitedRuntimes.includes(runtime.id) &&
        tierScore[runtime.maximumSupportedTier] >= tierScore[selectedRole.authorityCeiling]
    );

  if (!selectedRuntime) {
    return {
      status: "BLOCKED",
      reason: [`no registered runtime is eligible for role ${selectedRole.id}`],
      assembledSkills: [],
      allowedIntegrations: []
    };
  }

  const requestedIntegrationIds = request.requestedIntegrations ?? selectedRole.integrations.map((integration) => integration.id);
  const allowedIntegrations = requestedIntegrationIds.flatMap((integrationId) => {
    const roleIntegration = selectedRole.integrations.find((integration) => integration.id === integrationId);
    const integration = state.integrations.find((candidate) => candidate.id === integrationId);

    if (
      !roleIntegration ||
      !integration ||
      integration.status !== "sandbox" ||
      !integration.approvedRoles.includes(selectedRole.id)
    ) {
      return [];
    }

    const maximum = minTier(roleIntegration.maxTier, integration.permissionTier);

    if (tierScore[maximum] > tierScore.I2 || tierScore[maximum] > tierScore[selectedRole.authorityCeiling]) {
      return [];
    }

    return [{ id: integration.id, scopeRef: `${integration.id.toLowerCase()}/task-scoped`, maxTier: maximum }];
  });

  if (requestedIntegrationIds.length > 0 && allowedIntegrations.length !== requestedIntegrationIds.length) {
    return {
      status: "BLOCKED",
      reason: ["one or more requested integrations are unavailable, unapproved, unhealthy, or exceed the role authority boundary"],
      assembledSkills: [],
      allowedIntegrations: []
    };
  }

  const assembledSkills = [...new Set([...selectedRole.skills, ...(request.requiredSkills ?? [])])];
  const effectiveRiskTier = maxTier(
    request.riskTier === "restricted" ? "I2" : request.riskTier === "high" ? "I2" : request.riskTier === "moderate" ? "I2" : "I1",
    "I1"
  );
  const authorityTier = minTier(selectedRole.authorityCeiling, effectiveRiskTier);
  const taskEnvelope: TaskEnvelope = {
    metadata: {
      task_id: request.taskId,
      trace_id: request.traceId,
      idempotency_key: request.idempotencyKey
    },
    spec: {
      objective: request.objective,
      role_ref: { id: selectedRole.id, version: selectedRole.version },
      allowed_skills: assembledSkills,
      allowed_integrations: allowedIntegrations.map((integration) => ({
        id: integration.id,
        scope_ref: integration.scopeRef,
        max_tier: integration.maxTier
      })),
      runtime_route: { candidates: [selectedRuntime.id as TaskEnvelope["spec"]["runtime_route"]["candidates"][number]], selection_policy: "capability-router/v0.1" },
      authority: {
        risk_tier: request.riskTier,
        maximum_integration_tier: authorityTier,
        approval_policy_ref: "approval-policy"
      },
      output_contract: {
        required_artifacts: ["bounded-runtime-receipt"],
        result_schema_ref: "schemas/result-envelope.schema.json"
      }
    }
  };
  const agentPassport: AgentPassport = {
    metadata: {
      agent_instance_id: `agent_${request.taskId.replace("task_", "")}`,
      task_id: request.taskId,
      trace_id: request.traceId,
      issued_at: "1970-01-01T00:00:00Z",
      expires_at: request.hardStopAt
    },
    spec: {
      role_ref: taskEnvelope.spec.role_ref,
      runtime_id: selectedRuntime.id as AgentPassport["spec"]["runtime_id"],
      adapter_version: "0.1.0",
      allowed_skill_refs: assembledSkills,
      allowed_integration_scopes: allowedIntegrations.map((integration) => ({
        id: integration.id,
        scope_ref: integration.scopeRef,
        max_tier: integration.maxTier
      })),
      authority_ceiling: authorityTier,
      risk_tier: request.riskTier,
      input_data_classes: request.dataClassifications,
      retention_rule: "data-handling-policy",
      revocation_ref: `revocation/${request.taskId}`,
      nonce: `router-${request.traceId}-nonce`,
      idempotency_key: request.idempotencyKey
    }
  };

  return {
    status: "ROUTED",
    reason: [`selected role ${selectedRole.id}`, `selected runtime ${selectedRuntime.id}`, "all requested switches are true"],
    selectedRole,
    selectedRuntime,
    assembledSkills,
    allowedIntegrations,
    taskEnvelope,
    agentPassport
  };
}

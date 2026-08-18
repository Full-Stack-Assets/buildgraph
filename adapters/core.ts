export type RuntimeId = "manus" | "openai" | "cursor" | "github" | "grok" | "claude";
export type IntegrationTier = "I0" | "I1" | "I2" | "I3" | "I4";

const tierScore: Record<IntegrationTier, number> = { I0: 0, I1: 1, I2: 2, I3: 3, I4: 4 };

export type TaskEnvelope = {
  metadata: {
    task_id: string;
    trace_id: string;
    idempotency_key: string;
  };
  spec: {
    objective: string;
    role_ref: { id: string; version: string };
    allowed_skills: string[];
    allowed_integrations: Array<{ id: string; scope_ref: string; max_tier: IntegrationTier }>;
    runtime_route: { candidates: RuntimeId[]; selection_policy: string };
    authority: { risk_tier: string; maximum_integration_tier: IntegrationTier; approval_policy_ref: string };
    output_contract: { required_artifacts: string[]; result_schema_ref: string };
  };
};

export type AgentPassport = {
  metadata: {
    agent_instance_id: string;
    task_id: string;
    trace_id: string;
    issued_at: string;
    expires_at: string;
  };
  spec: {
    role_ref: { id: string; version: string };
    runtime_id: RuntimeId;
    adapter_version: string;
    allowed_skill_refs: string[];
    allowed_integration_scopes: Array<{ id: string; scope_ref: string; max_tier: IntegrationTier }>;
    authority_ceiling: IntegrationTier;
    risk_tier: string;
    input_data_classes: string[];
    retention_rule: string;
    revocation_ref: string;
    nonce: string;
    idempotency_key: string;
  };
};

export type RuntimeCapability = {
  runtime_id: RuntimeId;
  adapter_version: string;
  maximum_supported_tier: IntegrationTier;
  supports_structured_result: boolean;
  supports_draft_creation: boolean;
  supports_pull_request_creation: boolean;
  execution_boundary: "projection-and-receipt-only";
};

export type RuntimeProjection = {
  runtime_id: RuntimeId;
  task_id: string;
  trace_id: string;
  role_id: string;
  instruction: string;
  allowed_skill_refs: string[];
  allowed_integration_scopes: Array<{ id: string; scope_ref: string; max_tier: IntegrationTier }>;
  prohibited_actions: string[];
  output_schema_ref: string;
};

export type RuntimeReceipt = {
  execution_status: "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELLED";
  outputs: Array<{ artifact_id: string; type: string; uri: string; summary?: string }>;
  provenance: { tools: string[]; source_ids: string[]; workflow_version: string; rights_or_usage_status?: string };
  quality_evidence: Array<{ gate_id: string; status: "passed" | "failed" | "not_applicable" | "needs_review"; evidence_ref: string }>;
  risks_and_uncertainties: Array<{ description: string; severity: "low" | "moderate" | "high" | "restricted"; mitigation_or_owner: string }>;
  required_human_decision: { decision: string; owner: string; reason: string } | null;
  next_handoff: { target_role_or_owner: string; required_inputs: string[] };
  metrics: { latency_ms: number; cost_unit: string };
};

export type NormalizedResult = {
  api_version: "buildgraph/v0.2";
  kind: "ResultEnvelope";
  metadata: {
    task_id: string;
    agent_instance_id: string;
    trace_id: string;
    role_id: string;
    runtime_id: RuntimeId;
    created_at: string;
  };
  spec: RuntimeReceipt & {
    status: "NEEDS_REVIEW" | "BLOCKED";
  };
};

export interface RuntimeAdapter {
  readonly capability: RuntimeCapability;
  compile(task: TaskEnvelope, passport: AgentPassport): RuntimeProjection;
  normalize(task: TaskEnvelope, passport: AgentPassport, receipt: RuntimeReceipt, createdAt: string): NormalizedResult;
}

function assertTierAtMost(value: IntegrationTier, maximum: IntegrationTier, message: string): void {
  if (tierScore[value] > tierScore[maximum]) {
    throw new Error(message);
  }
}

function assertSameReference(left: { id: string; version: string }, right: { id: string; version: string }, message: string): void {
  if (left.id !== right.id || left.version !== right.version) {
    throw new Error(message);
  }
}

function assertPassportScope(runtimeId: RuntimeId, task: TaskEnvelope, passport: AgentPassport, capability: RuntimeCapability): void {
  if (passport.metadata.task_id !== task.metadata.task_id || passport.metadata.trace_id !== task.metadata.trace_id) {
    throw new Error("passport task or trace binding does not match task envelope");
  }

  if (passport.spec.runtime_id !== runtimeId || !task.spec.runtime_route.candidates.includes(runtimeId)) {
    throw new Error("runtime is not authorized for this task and passport");
  }

  assertSameReference(task.spec.role_ref, passport.spec.role_ref, "passport role binding does not match task role");
  assertTierAtMost(task.spec.authority.maximum_integration_tier, "I2", "BuildGraph v0 adapters reject authority above I2");
  assertTierAtMost(passport.spec.authority_ceiling, "I2", "BuildGraph v0 passports reject authority above I2");
  assertTierAtMost(passport.spec.authority_ceiling, capability.maximum_supported_tier, "passport authority exceeds adapter capability");

  for (const skillId of passport.spec.allowed_skill_refs) {
    if (!task.spec.allowed_skills.includes(skillId)) {
      throw new Error(`passport skill ${skillId} is not allowed by task envelope`);
    }
  }

  for (const scope of passport.spec.allowed_integration_scopes) {
    const taskScope = task.spec.allowed_integrations.find(
      (candidate) => candidate.id === scope.id && candidate.scope_ref === scope.scope_ref
    );

    if (!taskScope) {
      throw new Error(`passport integration scope ${scope.id}:${scope.scope_ref} is not allowed by task envelope`);
    }

    assertTierAtMost(scope.max_tier, taskScope.max_tier, `passport integration tier exceeds task scope for ${scope.id}`);
    assertTierAtMost(scope.max_tier, passport.spec.authority_ceiling, `passport integration tier exceeds authority ceiling for ${scope.id}`);
  }
}

export function createControlledAdapter(capability: RuntimeCapability): RuntimeAdapter {
  return {
    capability,
    compile(task, passport) {
      assertPassportScope(capability.runtime_id, task, passport, capability);

      return {
        runtime_id: capability.runtime_id,
        task_id: task.metadata.task_id,
        trace_id: task.metadata.trace_id,
        role_id: task.spec.role_ref.id,
        instruction: `Execute only the assigned objective for role ${task.spec.role_ref.id}. Return a BuildGraph ResultEnvelope receipt. Do not publish, send, merge, deploy, pay, alter permissions, or perform irreversible action.`,
        allowed_skill_refs: passport.spec.allowed_skill_refs,
        allowed_integration_scopes: passport.spec.allowed_integration_scopes,
        prohibited_actions: [
          "external communication",
          "public publication",
          "protected-branch merge",
          "production deployment",
          "payment or financial action",
          "identity or permission change",
          "destructive action"
        ],
        output_schema_ref: task.spec.output_contract.result_schema_ref
      };
    },
    normalize(task, passport, receipt, createdAt) {
      assertPassportScope(capability.runtime_id, task, passport, capability);

      return {
        api_version: "buildgraph/v0.2",
        kind: "ResultEnvelope",
        metadata: {
          task_id: task.metadata.task_id,
          agent_instance_id: passport.metadata.agent_instance_id,
          trace_id: task.metadata.trace_id,
          role_id: task.spec.role_ref.id,
          runtime_id: capability.runtime_id,
          created_at: createdAt
        },
        spec: {
          status: receipt.execution_status === "SUCCEEDED" ? "NEEDS_REVIEW" : "BLOCKED",
          ...receipt
        }
      };
    }
  };
}

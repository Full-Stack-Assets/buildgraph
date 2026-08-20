import { randomUUID } from "node:crypto";
import type {
  ActionGrant,
  ActionReceipt,
  AdapterId,
  InferenceRequest,
  JsonObject,
  WriteRequest
} from "./core.js";
import { assertNonEmpty, sha256Hex, utf8 } from "./core.js";

export type ActionPolicy = {
  writesEnabled: boolean;
  inferenceEnabled: boolean;
  requireApprovalFor: Array<"create" | "update" | "inference">;
  clock?: () => Date;
};

export type AuthorizedAction = {
  payloadSha256: string;
  startedAt: string;
};

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertIdentifier(value: string, field: string): void {
  assertNonEmpty(value, field);
  if (value.length > 256) throw new Error(`${field} exceeds 256 characters`);
}

function isResourceWithinScope(destination: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => {
    if (prefix.length === 0 || prefix.includes("\0")) return false;
    if (destination === prefix) return true;
    if (prefix.endsWith(":") || prefix.endsWith("/")) return destination.startsWith(prefix);
    return destination.startsWith(`${prefix}/`);
  });
}

function validateCommon(
  adapterId: AdapterId,
  operation: "create" | "update" | "inference",
  destination: string,
  byteLength: number,
  approvalRef: string | null,
  grant: ActionGrant,
  policy: ActionPolicy
): string {
  assertIdentifier(grant.grantId, "grant.grantId");
  assertNonEmpty(destination, "destination");
  if (!Number.isSafeInteger(grant.maximumBytes) || grant.maximumBytes < 0) {
    throw new Error("action grant maximumBytes must be a non-negative safe integer");
  }
  if (!Array.isArray(grant.resourcePrefixes) || grant.resourcePrefixes.length === 0) {
    throw new Error("action grant must include at least one resource prefix");
  }

  const now = (policy.clock ?? (() => new Date()))();
  const issuedAt = new Date(grant.issuedAt);
  const expiresAt = new Date(grant.expiresAt);
  if (!Number.isFinite(issuedAt.valueOf()) || !Number.isFinite(expiresAt.valueOf())) {
    throw new Error("action grant has an invalid validity window");
  }
  if (issuedAt >= expiresAt) {
    throw new Error("action grant validity window is empty or reversed");
  }
  if (issuedAt > now || expiresAt <= now) {
    throw new Error("action grant is not currently valid");
  }
  if (grant.adapterId !== adapterId) {
    throw new Error("action grant is bound to a different adapter");
  }
  if (!grant.operations.includes(operation)) {
    throw new Error(`action grant does not authorize ${operation}`);
  }
  if (byteLength > grant.maximumBytes) {
    throw new Error("action payload exceeds grant maximumBytes");
  }
  if (!isResourceWithinScope(destination, grant.resourcePrefixes)) {
    throw new Error("action destination is outside the granted resource scope");
  }
  if (policy.requireApprovalFor.includes(operation)) {
    if (!approvalRef || !grant.approvalRef || approvalRef !== grant.approvalRef) {
      throw new Error(`action ${operation} requires a matching approval reference`);
    }
  }
  return now.toISOString();
}

export function authorizeWrite(
  adapterId: AdapterId,
  request: WriteRequest,
  grant: ActionGrant,
  policy: ActionPolicy
): AuthorizedAction {
  if (!policy.writesEnabled) {
    throw new Error("adapter writes are disabled by the deployment kill switch");
  }
  assertIdentifier(request.idempotencyKey, "idempotencyKey");
  assertNonEmpty(request.name, "name");
  assertNonEmpty(request.mimeType, "mimeType");
  const startedAt = validateCommon(
    adapterId,
    request.operation,
    request.destination,
    request.bytes.byteLength,
    request.approvalRef,
    grant,
    policy
  );
  const payloadSha256 = sha256Hex(
    utf8(
      stableJson({
        operation: request.operation,
        destination: request.destination,
        name: request.name,
        mimeType: request.mimeType,
        bytesSha256: sha256Hex(request.bytes),
        metadata: request.metadata,
        expectedVersion: request.expectedVersion,
        idempotencyKey: request.idempotencyKey,
        approvalRef: request.approvalRef
      })
    )
  );
  return { payloadSha256, startedAt };
}

export function authorizeInference(
  adapterId: AdapterId,
  request: InferenceRequest,
  grant: ActionGrant,
  policy: ActionPolicy
): AuthorizedAction {
  if (!policy.inferenceEnabled) {
    throw new Error("adapter inference is disabled by the deployment kill switch");
  }
  assertNonEmpty(request.prompt, "prompt");
  assertIdentifier(request.idempotencyKey, "idempotencyKey");
  if (!Array.isArray(request.resourceRefs) || request.resourceRefs.length === 0) {
    throw new Error("inference requires at least one resource reference");
  }
  for (const [index, resourceRef] of request.resourceRefs.entries()) {
    assertNonEmpty(resourceRef, `resourceRefs[${index}]`);
  }
  const destination = request.resourceRefs[0]!;
  const byteLength = utf8(request.prompt).byteLength + (request.systemInstruction ? utf8(request.systemInstruction).byteLength : 0);
  const startedAt = validateCommon(
    adapterId,
    "inference",
    destination,
    byteLength,
    request.approvalRef,
    grant,
    policy
  );
  if (request.resourceRefs.some((resourceRef) => !isResourceWithinScope(resourceRef, grant.resourcePrefixes))) {
    throw new Error("one or more inference resources are outside the granted resource scope");
  }
  return {
    payloadSha256: sha256Hex(
      utf8(
        stableJson({
          prompt: request.prompt,
          systemInstruction: request.systemInstruction,
          resourceRefs: request.resourceRefs,
          idempotencyKey: request.idempotencyKey,
          approvalRef: request.approvalRef,
          metadata: request.metadata
        })
      )
    ),
    startedAt
  };
}

export function makeReceipt(input: {
  adapterId: AdapterId;
  operation: "create" | "update" | "inference";
  requestIdempotencyKey: string;
  authorization: AuthorizedAction;
  grant: ActionGrant;
  approvalRef: string | null;
  providerObjectId: string | null;
  providerVersion: string | null;
  status: ActionReceipt["status"];
  evidence?: JsonObject;
  clock?: () => Date;
}): ActionReceipt {
  return {
    receiptId: `receipt-${randomUUID()}`,
    adapterId: input.adapterId,
    operation: input.operation,
    idempotencyKey: input.requestIdempotencyKey,
    payloadSha256: input.authorization.payloadSha256,
    grantId: input.grant.grantId,
    approvalRef: input.approvalRef,
    providerObjectId: input.providerObjectId,
    providerVersion: input.providerVersion,
    status: input.status,
    startedAt: input.authorization.startedAt,
    completedAt: (input.clock ?? (() => new Date()))().toISOString(),
    evidence: input.evidence ?? {}
  };
}

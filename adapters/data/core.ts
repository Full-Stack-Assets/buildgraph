import { createHash } from "node:crypto";

export type AdapterId = "grok" | "gemini" | "copilot" | "icloud" | "iphone-local";
export type DataOperation = "list" | "read" | "create" | "update" | "inference";
export type EvidenceState = "UNVERIFIED" | "DECLARED" | "TESTED" | "VERIFIED" | "DEGRADED";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type DataAdapterCapabilities = {
  adapterId: AdapterId;
  evidenceState: EvidenceState;
  operations: readonly DataOperation[];
  supportsIncrementalCursor: boolean;
  supportsContentDownload: boolean;
  supportsContinuousSync: boolean;
  maximumItemBytes: number;
  constraints: string[];
};

export type AdapterHealth = {
  adapterId: AdapterId;
  status: "HEALTHY" | "DEGRADED" | "UNAUTHENTICATED" | "UNREACHABLE";
  checkedAt: string;
  latencyMs: number;
  authenticated: boolean;
  readVerified: boolean;
  writeConfigured: boolean;
  detail: string;
  evidence: JsonObject;
};

export type DataItem = {
  adapterId: AdapterId;
  externalId: string;
  version: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  createdAt: string | null;
  modifiedAt: string | null;
  contentHash: string | null;
  contentAvailability: "downloadable" | "metadata-only" | "session-events" | "cloud-asset";
  deleted: boolean;
  sourceUri: string;
  metadata: JsonObject;
};

export type ChangePage = {
  adapterId: AdapterId;
  observedAt: string;
  items: DataItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type ReadResult = {
  item: DataItem;
  bytes: Uint8Array | null;
  contentHash: string | null;
  unavailableReason: string | null;
};

export type WriteRequest = {
  operation: "create" | "update";
  destination: string;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  metadata: JsonObject;
  expectedVersion: string | null;
  idempotencyKey: string;
  approvalRef: string | null;
};

export type InferenceRequest = {
  prompt: string;
  systemInstruction: string | null;
  resourceRefs: string[];
  idempotencyKey: string;
  approvalRef: string | null;
  metadata: JsonObject;
};

export type ActionGrant = {
  grantId: string;
  adapterId: AdapterId;
  operations: Array<"create" | "update" | "inference">;
  resourcePrefixes: string[];
  maximumBytes: number;
  issuedAt: string;
  expiresAt: string;
  approvalRef: string | null;
};

export type ActionReceipt = {
  receiptId: string;
  adapterId: AdapterId;
  operation: "create" | "update" | "inference";
  idempotencyKey: string;
  payloadSha256: string;
  grantId: string;
  approvalRef: string | null;
  providerObjectId: string | null;
  providerVersion: string | null;
  status: "SUCCEEDED" | "FAILED" | "CONFLICT" | "BLOCKED";
  startedAt: string;
  completedAt: string;
  evidence: JsonObject;
};

export type InferenceResult = {
  receipt: ActionReceipt;
  outputText: string;
  providerResponseId: string | null;
  citations: JsonValue[];
  rawSummary: JsonObject;
};

export interface DataAdapter {
  readonly capabilities: DataAdapterCapabilities;
  healthCheck(): Promise<AdapterHealth>;
  listChanges(cursor: string | null): Promise<ChangePage>;
  read(item: DataItem): Promise<ReadResult>;
  write(request: WriteRequest, grant: ActionGrant): Promise<ActionReceipt>;
}

export interface AIDataAdapter extends DataAdapter {
  infer(request: InferenceRequest, grant: ActionGrant): Promise<InferenceResult>;
}

export function isAIDataAdapter(adapter: DataAdapter): adapter is AIDataAdapter {
  return "infer" in adapter && typeof (adapter as Partial<AIDataAdapter>).infer === "function";
}

export function sha256Hex(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function isoFromUnixSeconds(value: number): string {
  return new Date(value * 1000).toISOString();
}

export function assertNonEmpty(value: string, field: string): void {
  if (!value.trim() || value.includes("\0")) {
    throw new Error(`${field} must be a non-empty string without NUL bytes`);
  }
}

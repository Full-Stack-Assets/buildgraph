import type {
  ActionGrant,
  AdapterHealth,
  ChangePage,
  DataAdapter,
  DataItem,
  JsonObject,
  ReadResult,
  WriteRequest
} from "../core.js";
import { sha256Hex } from "../core.js";
import { authorizeWrite, makeReceipt, type ActionPolicy } from "../authorization.js";
import { decodeCursor, encodeCursor } from "../cursor.js";
import { adapterJson, adapterRequest, classifyAdapterHealthError, type FetchLike, type Sleep } from "../http.js";
import { asArray, asNumber, asRecord, asString, toJsonObject, toJsonValue } from "../json.js";

const cloudKitHost = "api.apple-cloudkit.com";
const defaultRecordTypes = ["CanonDocument", "CanonWriteInstruction", "CanonWriteReceipt"];
const defaultAssetHosts = [".icloud-content.com", ".apple-cloudkit.com"];

export type CloudKitDataAdapterConfig = {
  containerIdentifier: string;
  environment: "development" | "production";
  database: "private";
  apiToken: string;
  webAuthToken?: string;
  zoneName?: string;
  recordTypes?: string[];
  assetHostAllowlist?: string[];
  maximumAssetBytes?: number;
  actionPolicy?: Partial<ActionPolicy>;
  fetcher?: FetchLike;
  sleep?: Sleep;
  clock?: () => Date;
};

export type PhoneWriteInstructionRequest = {
  instructionId: string;
  localOperation: "create" | "update";
  rootGrantId: string;
  actionGrantId: string;
  relativePath: string;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  expectedLocalSha256: string | null;
  expiresAt: string;
  idempotencyKey: string;
  approvalRef: string | null;
};

function defaultPolicy(config: CloudKitDataAdapterConfig): ActionPolicy {
  return {
    writesEnabled: config.actionPolicy?.writesEnabled ?? false,
    inferenceEnabled: false,
    requireApprovalFor: config.actionPolicy?.requireApprovalFor ?? ["update"],
    clock: config.actionPolicy?.clock ?? config.clock
  };
}

function cloudKitField(fields: Record<string, unknown>, name: string): unknown {
  return asRecord(fields[name]).value;
}

function timestamp(value: unknown): string | null {
  const numeric = asNumber(value);
  return numeric === null ? null : new Date(numeric).toISOString();
}

function recordToItem(value: unknown): DataItem | null {
  const record = asRecord(value);
  const recordName = asString(record.recordName);
  if (!recordName) return null;
  const fields = asRecord(record.fields);
  const modified = asRecord(record.modified);
  const created = asRecord(record.created);
  const asset = asRecord(cloudKitField(fields, "payload"));
  const metadataText = asString(cloudKitField(fields, "metadataJson"));
  let metadata: JsonObject = {};
  if (metadataText) {
    try {
      metadata = toJsonObject(JSON.parse(metadataText) as unknown);
    } catch {
      metadata = { parseError: true };
    }
  }
  metadata.recordType = toJsonValue(record.recordType ?? null);
  metadata.assetDownloadUrl = toJsonValue(asset.downloadURL ?? null);
  metadata.originAdapter = toJsonValue(cloudKitField(fields, "originAdapter") ?? null);
  return {
    adapterId: "icloud",
    externalId: recordName,
    version: asString(record.recordChangeTag),
    name: asString(cloudKitField(fields, "name")) ?? recordName,
    mimeType: asString(cloudKitField(fields, "mimeType")) ?? "application/octet-stream",
    sizeBytes: asNumber(cloudKitField(fields, "byteCount")) ?? asNumber(asset.size),
    createdAt: timestamp(created.timestamp),
    modifiedAt: timestamp(modified.timestamp),
    contentHash: asString(cloudKitField(fields, "contentHash")),
    contentAvailability: asString(asset.downloadURL) ? "cloud-asset" : "metadata-only",
    deleted: record.deleted === true,
    sourceUri: `icloud://records/${encodeURIComponent(recordName)}`,
    metadata
  };
}

function requireRecordName(destination: string): string {
  if (!destination.startsWith("record:")) throw new Error("CloudKit destination must be record:<recordName>");
  const value = destination.slice("record:".length);
  if (!/^[A-Za-z0-9._:-]{1,180}$/.test(value)) throw new Error("CloudKit record name contains unsupported characters");
  return value;
}

function requireUuid(value: string, field: string): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) {
    throw new Error(`${field} must be a UUID`);
  }
  return value;
}

function requireRelativePath(value: string): string {
  if (!value || value.startsWith("/") || value.includes("\\") || value.includes("\0")) {
    throw new Error("phone instruction relativePath is invalid");
  }
  const components = value.split("/");
  if (components.some((component) => !component || component === "." || component === "..")) {
    throw new Error("phone instruction relativePath is invalid");
  }
  return components.join("/");
}

export class CloudKitDataAdapter implements DataAdapter {
  readonly capabilities;
  readonly #config: CloudKitDataAdapterConfig;
  readonly #policy: ActionPolicy;

  constructor(config: CloudKitDataAdapterConfig) {
    if (!/^iCloud\.[A-Za-z0-9.-]+$/.test(config.containerIdentifier)) throw new Error("invalid CloudKit container identifier");
    if (!config.apiToken.trim()) throw new Error("CloudKit API token is not configured");
    if (config.database !== "private") throw new Error("Canon CloudKit custom-zone sync requires a private database");
    if (!config.webAuthToken?.trim()) throw new Error("CloudKit private database access requires a delegated web authentication token");
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(config.zoneName ?? "CanonSyncZone")) {
      throw new Error("CloudKit zone name is invalid");
    }
    const recordTypes = config.recordTypes ?? defaultRecordTypes;
    if (recordTypes.length === 0 || new Set(recordTypes).size !== recordTypes.length
      || recordTypes.some((value) => !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(value))) {
      throw new Error("CloudKit recordTypes must contain unique valid record type names");
    }
    const assetHosts = config.assetHostAllowlist ?? defaultAssetHosts;
    if (assetHosts.length === 0 || assetHosts.some((value) => {
      const host = value.toLowerCase();
      return !(host === ".icloud-content.com" || host.endsWith(".icloud-content.com")
        || host === ".apple-cloudkit.com" || host.endsWith(".apple-cloudkit.com"));
    })) {
      throw new Error("CloudKit asset hosts must be Apple CloudKit content hosts");
    }
    const maximumAssetBytes = config.maximumAssetBytes ?? 15 * 1024 * 1024;
    if (!Number.isSafeInteger(maximumAssetBytes) || maximumAssetBytes < 1 || maximumAssetBytes > 15 * 1024 * 1024) {
      throw new Error("CloudKit maximumAssetBytes must be from 1 through 15728640");
    }
    this.#config = config;
    this.#policy = defaultPolicy(config);
    this.capabilities = {
      adapterId: "icloud" as const,
      evidenceState: "TESTED" as const,
      operations: ["list", "read", "create", "update"] as const,
      supportsIncrementalCursor: true,
      supportsContentDownload: true,
      supportsContinuousSync: true,
      maximumItemBytes: maximumAssetBytes,
      constraints: [
        "CloudKit access is limited to the configured app container; it is not arbitrary server-side access to a user's entire iCloud Drive.",
        "Private/shared database access requires interactive Apple user authentication and a renewable web authentication token.",
        "Custom-zone change tokens provide incremental sync; the companion iPhone bridge must use the same zone and record contract."
      ]
    };
  }

  #endpoint(operation: string): URL {
    const url = new URL(
      `https://api.apple-cloudkit.com/database/1/${encodeURIComponent(this.#config.containerIdentifier)}/${this.#config.environment}/${this.#config.database}/${operation}`
    );
    url.searchParams.set("ckAPIToken", this.#config.apiToken);
    if (this.#config.webAuthToken) url.searchParams.set("ckWebAuthToken", this.#config.webAuthToken);
    return url;
  }

  async #post<T>(
    operation: string,
    body: unknown,
    maximumResponseBytes = 2 * 1024 * 1024,
    retrySafe = false
  ): Promise<T> {
    const { value } = await adapterJson<T>({
      url: this.#endpoint(operation),
      init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      allowedHosts: [cloudKitHost],
      maximumResponseBytes,
      retryMutation: retrySafe,
      fetcher: this.#config.fetcher,
      sleep: this.#config.sleep
    });
    return value;
  }

  async healthCheck(): Promise<AdapterHealth> {
    const started = Date.now();
    try {
      await this.#post("changes/zone", {
        zones: [{ zoneID: { zoneName: this.#config.zoneName ?? "CanonSyncZone" } }],
        resultsLimit: 1,
        desiredRecordTypes: this.#config.recordTypes ?? defaultRecordTypes
      }, 2 * 1024 * 1024, true);
      return {
        adapterId: "icloud",
        status: "HEALTHY",
        checkedAt: (this.#config.clock ?? (() => new Date()))().toISOString(),
        latencyMs: Date.now() - started,
        authenticated: true,
        readVerified: true,
        writeConfigured: this.#policy.writesEnabled,
        detail: "CloudKit custom zone is reachable.",
        evidence: { database: this.#config.database, zone: this.#config.zoneName ?? "CanonSyncZone" }
      };
    } catch (error) {
      return {
        adapterId: "icloud",
        status: classifyAdapterHealthError(error),
        checkedAt: (this.#config.clock ?? (() => new Date()))().toISOString(),
        latencyMs: Date.now() - started,
        authenticated: false,
        readVerified: false,
        writeConfigured: this.#policy.writesEnabled,
        detail: error instanceof Error ? error.message : "CloudKit health probe failed.",
        evidence: {}
      };
    }
  }

  async listChanges(cursor: string | null): Promise<ChangePage> {
    const state = decodeCursor(cursor);
    const syncToken = asString(state.syncToken);
    const zone: Record<string, unknown> = { zoneID: { zoneName: this.#config.zoneName ?? "CanonSyncZone" } };
    if (syncToken) zone.syncToken = syncToken;
    const value = await this.#post<Record<string, unknown>>("changes/zone", {
      zones: [zone],
      resultsLimit: 200,
      desiredRecordTypes: this.#config.recordTypes ?? defaultRecordTypes
    }, 2 * 1024 * 1024, true);
    const zoneResult = asRecord(asArray(value.zones)[0]);
    const serverError = asString(zoneResult.serverErrorCode);
    if (serverError) throw new Error(`CloudKit change fetch failed with ${serverError}`);
    const items = asArray(zoneResult.records).map(recordToItem).filter((item): item is DataItem => item !== null);
    const nextToken = asString(zoneResult.syncToken) ?? syncToken;
    const moreComing = zoneResult.moreComing === true;
    return {
      adapterId: "icloud",
      observedAt: (this.#config.clock ?? (() => new Date()))().toISOString(),
      items,
      nextCursor: encodeCursor({ syncToken: nextToken }),
      hasMore: moreComing
    };
  }

  async #lookup(recordName: string): Promise<Record<string, unknown>> {
    const value = await this.#post<Record<string, unknown>>("records/lookup", {
      zoneID: { zoneName: this.#config.zoneName ?? "CanonSyncZone" },
      records: [{ recordName }]
    }, 2 * 1024 * 1024, true);
    const record = asRecord(asArray(value.records)[0]);
    const serverError = asString(record.serverErrorCode);
    if (serverError) throw new Error(`CloudKit record lookup failed with ${serverError}`);
    return record;
  }

  async read(item: DataItem): Promise<ReadResult> {
    if (item.adapterId !== "icloud" || !/^[A-Za-z0-9._:-]{1,180}$/.test(item.externalId)) {
      throw new Error("CloudKit read item is outside the adapter namespace");
    }
    const record = await this.#lookup(item.externalId);
    const refreshed = recordToItem(record) ?? item;
    const asset = asRecord(cloudKitField(asRecord(record.fields), "payload"));
    const downloadUrl = asString(asset.downloadURL);
    if (!downloadUrl) {
      return { item: refreshed, bytes: null, contentHash: refreshed.contentHash, unavailableReason: "CloudKit record has no payload asset." };
    }
    if (refreshed.sizeBytes !== null && refreshed.sizeBytes > this.capabilities.maximumItemBytes) {
      return { item: refreshed, bytes: null, contentHash: refreshed.contentHash, unavailableReason: "CloudKit asset exceeds adapter maximumItemBytes." };
    }
    try {
      const result = await adapterRequest({
        url: downloadUrl,
        allowedHosts: this.#config.assetHostAllowlist ?? defaultAssetHosts,
        maximumResponseBytes: this.capabilities.maximumItemBytes,
        fetcher: this.#config.fetcher,
        sleep: this.#config.sleep
      });
      return { item: refreshed, bytes: result.bytes, contentHash: sha256Hex(result.bytes), unavailableReason: null };
    } catch (error) {
      if (error instanceof Error && error.message.includes("exceeded the configured byte limit")) {
        return { item: refreshed, bytes: null, contentHash: refreshed.contentHash, unavailableReason: "CloudKit asset exceeds adapter maximumItemBytes." };
      }
      throw error;
    }
  }

  async #uploadAsset(recordType: string, recordName: string, bytes: Uint8Array, mimeType: string): Promise<Record<string, unknown>> {
    const tokenResponse = await this.#post<Record<string, unknown>>("assets/upload", {
      zoneID: { zoneName: this.#config.zoneName ?? "CanonSyncZone" },
      tokens: [{ recordType, recordName, fieldName: "payload" }]
    });
    const token = asRecord(asArray(tokenResponse.tokens)[0]);
    const uploadUrl = asString(token.url);
    if (!uploadUrl) throw new Error("CloudKit asset upload did not return an upload URL");
    const uploaded = await adapterJson<Record<string, unknown>>({
      url: uploadUrl,
      init: { method: "POST", headers: { "Content-Type": mimeType }, body: bytes.slice().buffer },
      allowedHosts: this.#config.assetHostAllowlist ?? defaultAssetHosts,
      maximumResponseBytes: 512 * 1024,
      retryMutation: false,
      fetcher: this.#config.fetcher,
      sleep: this.#config.sleep
    });
    return asRecord(uploaded.value.singleFile ?? uploaded.value);
  }

  async write(request: WriteRequest, grant: ActionGrant) {
    if (request.bytes.byteLength > this.capabilities.maximumItemBytes) throw new Error("CloudKit asset exceeds adapter maximumItemBytes");
    const authorization = authorizeWrite("icloud", request, grant, this.#policy);
    const recordName = requireRecordName(request.destination);
    if (request.operation === "update" && !request.expectedVersion) {
      throw new Error("CloudKit conflict-safe update requires expectedVersion");
    }
    const recordType = asString(request.metadata.recordType) ?? "CanonDocument";
    if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(recordType)) throw new Error("CloudKit record type is invalid");
    const fields: Record<string, unknown> = {
      name: { value: request.name },
      mimeType: { value: request.mimeType },
      byteCount: { value: request.bytes.byteLength },
      contentHash: { value: sha256Hex(request.bytes) },
      modifiedAt: { value: (this.#config.clock ?? (() => new Date()))().toISOString() },
      originAdapter: { value: asString(request.metadata.originAdapter) ?? "icloud" },
      metadataJson: { value: JSON.stringify(request.metadata) }
    };
    if (recordType === "CanonWriteInstruction") {
      const localOperation = asString(request.metadata.localOperation);
      const rootGrantId = asString(request.metadata.rootGrantId);
      const actionGrantId = asString(request.metadata.actionGrantId);
      const relativePath = asString(request.metadata.relativePath);
      const expiresAt = asString(request.metadata.expiresAt);
      if ((localOperation !== "create" && localOperation !== "update") || !rootGrantId || !actionGrantId || !relativePath || !expiresAt) {
        throw new Error("CanonWriteInstruction metadata is incomplete");
      }
      const expiration = new Date(expiresAt);
      const now = (this.#config.clock ?? (() => new Date()))();
      if (!Number.isFinite(expiration.valueOf()) || expiration <= now || expiration.valueOf() - now.valueOf() > 24 * 60 * 60 * 1000) {
        throw new Error("CanonWriteInstruction expiry must be within the next 24 hours");
      }
      if (request.bytes.byteLength === 0) throw new Error("CanonWriteInstruction requires a payload asset");
      fields.operation = { value: localOperation };
      fields.rootGrantID = { value: requireUuid(rootGrantId, "rootGrantId") };
      fields.actionGrantID = { value: requireUuid(actionGrantId, "actionGrantId") };
      fields.relativePath = { value: requireRelativePath(relativePath) };
      fields.idempotencyKey = { value: request.idempotencyKey };
      fields.expiresAt = { value: expiration.valueOf(), type: "TIMESTAMP" };
      const expectedLocalSha256 = asString(request.metadata.expectedLocalSha256);
      if (expectedLocalSha256 && !/^[a-f0-9]{64}$/.test(expectedLocalSha256)) {
        throw new Error("CanonWriteInstruction expected local SHA-256 is invalid");
      }
      if (localOperation === "update" && (!request.approvalRef || request.approvalRef !== grant.approvalRef || !expectedLocalSha256)) {
        throw new Error("phone update instruction requires approval and an expected local SHA-256");
      }
      if (expectedLocalSha256) fields.expectedLocalSHA256 = { value: expectedLocalSha256 };
      if (request.approvalRef) fields.approvalReference = { value: request.approvalRef };
    }
    const asset = request.bytes.byteLength > 0 ? await this.#uploadAsset(recordType, recordName, request.bytes, request.mimeType) : null;
    if (asset) fields.payload = { value: asset };
    const record: Record<string, unknown> = { recordType, recordName, fields };
    if (request.expectedVersion) record.recordChangeTag = request.expectedVersion;
    const value = await this.#post<Record<string, unknown>>("records/modify", {
      zoneID: { zoneName: this.#config.zoneName ?? "CanonSyncZone" },
      atomic: true,
      operations: [{ operationType: request.operation, record }]
    });
    const result = asRecord(asArray(value.records)[0]);
    const serverError = asString(result.serverErrorCode);
    if (serverError) {
      const status = serverError === "CONFLICT" ? "CONFLICT" : "FAILED";
      return makeReceipt({
        adapterId: "icloud",
        operation: request.operation,
        requestIdempotencyKey: request.idempotencyKey,
        authorization,
        grant,
        approvalRef: request.approvalRef,
        providerObjectId: recordName,
        providerVersion: null,
        status,
        evidence: { serverError },
        clock: this.#config.clock
      });
    }
    return makeReceipt({
      adapterId: "icloud",
      operation: request.operation,
      requestIdempotencyKey: request.idempotencyKey,
      authorization,
      grant,
      approvalRef: request.approvalRef,
      providerObjectId: asString(result.recordName) ?? recordName,
      providerVersion: asString(result.recordChangeTag),
      status: "SUCCEEDED",
      evidence: { zone: this.#config.zoneName ?? "CanonSyncZone", recordType, asset: asset !== null },
      clock: this.#config.clock
    });
  }

  async writePhoneInstruction(input: PhoneWriteInstructionRequest, grant: ActionGrant) {
    const now = (this.#config.clock ?? (() => new Date()))();
    const expiresAt = new Date(input.expiresAt);
    if (!Number.isFinite(expiresAt.valueOf()) || expiresAt <= now || expiresAt.valueOf() - now.valueOf() > 24 * 60 * 60 * 1000) {
      throw new Error("phone instruction expiry must be within the next 24 hours");
    }
    if (input.localOperation === "update") {
      if (!input.approvalRef || input.approvalRef !== grant.approvalRef) {
        throw new Error("phone update instruction requires the CloudKit grant approval reference");
      }
      if (!input.expectedLocalSha256 || !/^[a-f0-9]{64}$/.test(input.expectedLocalSha256)) {
        throw new Error("phone update instruction requires an expected local SHA-256");
      }
    }
    return this.write({
      operation: "create",
      destination: `record:${input.instructionId}`,
      name: input.name,
      mimeType: input.mimeType,
      bytes: input.bytes,
      metadata: {
        recordType: "CanonWriteInstruction",
        localOperation: input.localOperation,
        rootGrantId: requireUuid(input.rootGrantId, "rootGrantId"),
        actionGrantId: requireUuid(input.actionGrantId, "actionGrantId"),
        relativePath: requireRelativePath(input.relativePath),
        expectedLocalSha256: input.expectedLocalSha256,
        expiresAt: input.expiresAt,
        originAdapter: "icloud"
      },
      expectedVersion: null,
      idempotencyKey: input.idempotencyKey,
      approvalRef: input.approvalRef
    }, grant);
  }
}

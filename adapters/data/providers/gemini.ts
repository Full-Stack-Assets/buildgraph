import type {
  ActionGrant,
  AdapterHealth,
  AIDataAdapter,
  ChangePage,
  DataItem,
  InferenceRequest,
  InferenceResult,
  ReadResult,
  WriteRequest
} from "../core.js";
import { authorizeInference, authorizeWrite, makeReceipt, type ActionPolicy } from "../authorization.js";
import { decodeCursor, encodeCursor } from "../cursor.js";
import { adapterJson, adapterRequest, classifyAdapterHealthError, type FetchLike, type Sleep } from "../http.js";
import { asArray, asIsoDate, asNumber, asRecord, asString, extractAnnotations, extractText, toJsonObject } from "../json.js";

const googleApiHost = "generativelanguage.googleapis.com";

export type GeminiDataAdapterConfig = {
  apiKey: string;
  fileSearchStoreNames?: string[];
  model?: string;
  maximumItemBytes?: number;
  operationPollIntervalMs?: number;
  operationTimeoutMs?: number;
  actionPolicy?: Partial<ActionPolicy>;
  fetcher?: FetchLike;
  sleep?: Sleep;
  clock?: () => Date;
};

function apiHeaders(apiKey: string, json = false): HeadersInit {
  if (!apiKey.trim()) throw new Error("Gemini credential is not configured");
  return { "x-goog-api-key": apiKey, ...(json ? { "Content-Type": "application/json" } : {}) };
}

function defaultPolicy(config: GeminiDataAdapterConfig): ActionPolicy {
  return {
    writesEnabled: config.actionPolicy?.writesEnabled ?? false,
    inferenceEnabled: config.actionPolicy?.inferenceEnabled ?? false,
    requireApprovalFor: config.actionPolicy?.requireApprovalFor ?? ["update"],
    clock: config.actionPolicy?.clock ?? config.clock
  };
}

function parseFile(value: unknown): DataItem | null {
  const file = asRecord(value);
  const name = asString(file.name);
  if (!name || !/^files\/[A-Za-z0-9-]+$/.test(name)) return null;
  const displayName = asString(file.displayName) ?? name;
  return {
    adapterId: "gemini",
    externalId: name,
    version: asIsoDate(file.updateTime),
    name: displayName,
    mimeType: asString(file.mimeType) ?? "application/octet-stream",
    sizeBytes: asNumber(file.sizeBytes),
    createdAt: asIsoDate(file.createTime),
    modifiedAt: asIsoDate(file.updateTime) ?? asIsoDate(file.createTime),
    contentHash: asString(file.sha256Hash),
    contentAvailability: "metadata-only",
    deleted: false,
    sourceUri: `gemini://${name}`,
    metadata: toJsonObject({
      state: file.state ?? null,
      source: file.source ?? null,
      expirationTime: file.expirationTime ?? null,
      uri: file.uri ?? null
    })
  };
}

function parseFileSearchDocument(value: unknown): DataItem | null {
  const document = asRecord(value);
  const name = asString(document.name);
  if (!name || !/^fileSearchStores\/[A-Za-z0-9_-]+\/documents\/[A-Za-z0-9_-]+$/.test(name)) return null;
  return {
    adapterId: "gemini",
    externalId: name,
    version: asIsoDate(document.updateTime),
    name: asString(document.displayName) ?? name.split("/").at(-1) ?? name,
    mimeType: asString(document.mimeType) ?? "application/octet-stream",
    sizeBytes: asNumber(document.sizeBytes),
    createdAt: asIsoDate(document.createTime),
    modifiedAt: asIsoDate(document.updateTime) ?? asIsoDate(document.createTime),
    contentHash: null,
    contentAvailability: "metadata-only",
    deleted: false,
    sourceUri: `gemini://${name}`,
    metadata: toJsonObject(document)
  };
}

function validStoreName(value: string): boolean {
  return /^fileSearchStores\/[A-Za-z0-9_-]+$/.test(value);
}

export class GeminiDataAdapter implements AIDataAdapter {
  readonly capabilities;
  readonly #config: GeminiDataAdapterConfig;
  readonly #policy: ActionPolicy;

  constructor(config: GeminiDataAdapterConfig) {
    const stores = config.fileSearchStoreNames ?? [];
    if (stores.some((name) => !validStoreName(name))) throw new Error("Gemini File Search store name is invalid");
    if (new Set(stores).size !== stores.length) throw new Error("Gemini File Search store names must be unique");
    if (!Number.isFinite(config.operationPollIntervalMs ?? 1_000) || (config.operationPollIntervalMs ?? 1_000) < 10) {
      throw new Error("Gemini operationPollIntervalMs must be at least 10ms");
    }
    if (!Number.isFinite(config.operationTimeoutMs ?? 300_000) || (config.operationTimeoutMs ?? 300_000) < 1_000) {
      throw new Error("Gemini operationTimeoutMs must be at least 1000ms");
    }
    const maximumItemBytes = config.maximumItemBytes ?? 50 * 1024 * 1024;
    if (!Number.isSafeInteger(maximumItemBytes) || maximumItemBytes < 1 || maximumItemBytes > 64 * 1024 * 1024) {
      throw new Error("Gemini maximumItemBytes must be from 1 through 67108864");
    }
    this.#config = config;
    this.#policy = defaultPolicy(config);
    this.capabilities = {
      adapterId: "gemini" as const,
      evidenceState: "TESTED" as const,
      operations: ["list", "read", "create", "inference"] as const,
      supportsIncrementalCursor: true,
      supportsContentDownload: false,
      supportsContinuousSync: true,
      maximumItemBytes,
      constraints: [
        "Gemini Files are API project resources, not consumer Gemini chat-history access.",
        "Gemini Files metadata can be listed, but original uploaded bytes are not downloadable through the Files API.",
        "Temporary Files expire; durable retrieval should use Canon as the source and Gemini File Search as a derived index."
      ]
    };
  }

  #storeName(value: string): string {
    if (!validStoreName(value)) throw new Error("Gemini File Search store name is invalid");
    const configured = this.#config.fileSearchStoreNames;
    if (!configured?.includes(value)) {
      throw new Error("Gemini File Search store is outside the deployment allowlist");
    }
    return value;
  }

  async #waitForOperation(name: string): Promise<Record<string, unknown>> {
    if (!/^(?:operations[/][A-Za-z0-9._-]+|fileSearchStores[/][A-Za-z0-9_-]+[/]operations[/][A-Za-z0-9._-]+)$/.test(name)) {
      throw new Error("Gemini operation name is invalid");
    }
    const started = Date.now();
    const timeoutMs = this.#config.operationTimeoutMs ?? 300_000;
    const sleep = this.#config.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    while (true) {
      const { value } = await adapterJson<Record<string, unknown>>({
        url: `https://generativelanguage.googleapis.com/v1beta/${name}`,
        init: { headers: apiHeaders(this.#config.apiKey) },
        allowedHosts: [googleApiHost],
        maximumResponseBytes: 512 * 1024,
        fetcher: this.#config.fetcher,
        sleep: this.#config.sleep
      });
      const error = asRecord(value.error);
      if (Object.keys(error).length > 0) {
        throw new Error(`Gemini File Search import failed${asString(error.status) ? ` with ${asString(error.status)}` : ""}`);
      }
      if (value.done === true) return value;
      if (Date.now() - started >= timeoutMs) throw new Error("Gemini File Search import operation timed out");
      await sleep(this.#config.operationPollIntervalMs ?? 1_000);
    }
  }

  async healthCheck(): Promise<AdapterHealth> {
    const started = Date.now();
    try {
      await adapterJson({
        url: "https://generativelanguage.googleapis.com/v1beta/files?pageSize=1",
        init: { headers: apiHeaders(this.#config.apiKey) },
        allowedHosts: [googleApiHost],
        maximumResponseBytes: 256 * 1024,
        fetcher: this.#config.fetcher,
        sleep: this.#config.sleep
      });
      const stores = this.#config.fileSearchStoreNames ?? [];
      for (const store of stores) {
        await adapterJson({
          url: `https://generativelanguage.googleapis.com/v1beta/${this.#storeName(store)}/documents?pageSize=1`,
          init: { headers: apiHeaders(this.#config.apiKey) },
          allowedHosts: [googleApiHost],
          maximumResponseBytes: 256 * 1024,
          fetcher: this.#config.fetcher,
          sleep: this.#config.sleep
        });
      }
      return {
        adapterId: "gemini",
        status: "HEALTHY",
        checkedAt: (this.#config.clock ?? (() => new Date()))().toISOString(),
        latencyMs: Date.now() - started,
        authenticated: true,
        readVerified: true,
        writeConfigured: this.#policy.writesEnabled,
        detail: stores.length > 0 ? "Gemini Files and configured File Search stores are reachable." : "Gemini Files credential accepted.",
        evidence: { files: "verified", fileSearchStoresVerified: stores.length }
      };
    } catch (error) {
      return {
        adapterId: "gemini",
        status: classifyAdapterHealthError(error),
        checkedAt: (this.#config.clock ?? (() => new Date()))().toISOString(),
        latencyMs: Date.now() - started,
        authenticated: false,
        readVerified: false,
        writeConfigured: this.#policy.writesEnabled,
        detail: error instanceof Error ? error.message : "Gemini health probe failed.",
        evidence: {}
      };
    }
  }

  async listChanges(cursor: string | null): Promise<ChangePage> {
    const state = decodeCursor(cursor);
    const stores = this.#config.fileSearchStoreNames ?? [];
    const phase = state.phase === "stores" && stores.length > 0 ? "stores" : "files";
    const storeIndex = Math.max(0, Math.trunc(asNumber(state.storeIndex) ?? 0));
    const pageToken = asString(state.pageToken);
    const since = asIsoDate(state.since);
    const cycleMaxSeen = asIsoDate(state.maxSeen) ?? since;
    const isStorePhase = phase === "stores";
    const store = isStorePhase ? this.#storeName(stores[Math.min(storeIndex, stores.length - 1)]!) : null;
    const url = store
      ? new URL(`https://generativelanguage.googleapis.com/v1beta/${store}/documents`)
      : new URL("https://generativelanguage.googleapis.com/v1beta/files");
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const { value } = await adapterJson<Record<string, unknown>>({
      url,
      init: { headers: apiHeaders(this.#config.apiKey) },
      allowedHosts: [googleApiHost],
      maximumResponseBytes: 2 * 1024 * 1024,
      fetcher: this.#config.fetcher,
      sleep: this.#config.sleep
    });
    const source = isStorePhase ? asArray(value.documents) : asArray(value.files);
    const parser = isStorePhase ? parseFileSearchDocument : parseFile;
    const parsed = source.map(parser).filter((item): item is DataItem => item !== null);
    const items = since ? parsed.filter((item) => !item.modifiedAt || item.modifiedAt >= since) : parsed;
    const nextPageToken = asString(value.nextPageToken);
    const maxSeen = parsed.reduce<string | null>((latest, item) => {
      if (!item.modifiedAt) return latest;
      return latest === null || item.modifiedAt > latest ? item.modifiedAt : latest;
    }, cycleMaxSeen);
    const advanceToStores = !isStorePhase && nextPageToken === null && stores.length > 0;
    const nextStoreIndex = isStorePhase && nextPageToken === null ? storeIndex + 1 : storeIndex;
    const advanceStore = isStorePhase && nextPageToken === null && nextStoreIndex < stores.length;
    const hasMore = nextPageToken !== null || advanceToStores || advanceStore;
    const nextPhase = advanceToStores || isStorePhase ? "stores" : "files";
    return {
      adapterId: "gemini",
      observedAt: (this.#config.clock ?? (() => new Date()))().toISOString(),
      items,
      nextCursor: encodeCursor({
        phase: hasMore ? nextPhase : "files",
        storeIndex: advanceToStores ? 0 : hasMore ? nextStoreIndex : 0,
        pageToken: nextPageToken,
        since: hasMore ? since : maxSeen,
        maxSeen: hasMore ? maxSeen : null
      }),
      hasMore
    };
  }

  async read(item: DataItem): Promise<ReadResult> {
    const fileItem = /^files\/[A-Za-z0-9-]+$/.test(item.externalId);
    const storeItem = /^fileSearchStores\/[A-Za-z0-9_-]+\/documents\/[A-Za-z0-9_-]+$/.test(item.externalId);
    if (item.adapterId !== "gemini" || (!fileItem && !storeItem)) {
      throw new Error("Gemini read item is outside the adapter namespace");
    }
    const { value } = await adapterJson<Record<string, unknown>>({
      url: `https://generativelanguage.googleapis.com/v1beta/${item.externalId}`,
      init: { headers: apiHeaders(this.#config.apiKey) },
      allowedHosts: [googleApiHost],
      maximumResponseBytes: 512 * 1024,
      fetcher: this.#config.fetcher,
      sleep: this.#config.sleep
    });
    const refreshed = fileItem ? parseFile(value) : parseFileSearchDocument(value);
    return {
      item: refreshed ?? item,
      bytes: null,
      contentHash: refreshed?.contentHash ?? item.contentHash,
      unavailableReason: "Gemini exposes metadata and retrieval results but does not expose original uploaded file bytes for download."
    };
  }

  async write(request: WriteRequest, grant: ActionGrant) {
    if (request.operation !== "create") throw new Error("Gemini adapter uses immutable create/import operations");
    if (request.bytes.byteLength > this.capabilities.maximumItemBytes) throw new Error("Gemini upload exceeds adapter maximumItemBytes");
    const authorization = authorizeWrite("gemini", request, grant, this.#policy);
    const destinationStore = validStoreName(request.destination) ? this.#storeName(request.destination) : null;
    if (destinationStore === null && request.destination !== "files:new") {
      throw new Error("Gemini destination must be files:new or an allowlisted File Search store");
    }
    const start = await adapterRequest({
      url: "https://generativelanguage.googleapis.com/upload/v1beta/files",
      init: {
        method: "POST",
        headers: {
          ...apiHeaders(this.#config.apiKey, true),
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": String(request.bytes.byteLength),
          "X-Goog-Upload-Header-Content-Type": request.mimeType
        },
        body: JSON.stringify({ file: { displayName: request.name } })
      },
      allowedHosts: [googleApiHost],
      maximumResponseBytes: 256 * 1024,
      retryMutation: false,
      fetcher: this.#config.fetcher,
      sleep: this.#config.sleep
    });
    const uploadUrl = start.response.headers.get("x-goog-upload-url");
    if (!uploadUrl) throw new Error("Gemini resumable upload did not return an upload URL");
    const { value } = await adapterJson<Record<string, unknown>>({
      url: uploadUrl,
      init: {
        method: "POST",
        headers: {
          ...apiHeaders(this.#config.apiKey),
          "Content-Length": String(request.bytes.byteLength),
          "X-Goog-Upload-Offset": "0",
          "X-Goog-Upload-Command": "upload, finalize",
          "Idempotency-Key": request.idempotencyKey
        },
        body: request.bytes.slice().buffer
      },
      allowedHosts: [googleApiHost, "upload.googleapis.com"],
      maximumResponseBytes: 512 * 1024,
      retryMutation: false,
      fetcher: this.#config.fetcher,
      sleep: this.#config.sleep
    });
    const file = asRecord(value.file);
    const fileName = asString(file.name);
    if (!fileName) throw new Error("Gemini upload response did not include a file name");

    let operationName: string | null = null;
    if (destinationStore) {
      const imported = await adapterJson<Record<string, unknown>>({
        url: `https://generativelanguage.googleapis.com/v1beta/${destinationStore}:importFile`,
        init: {
          method: "POST",
          headers: apiHeaders(this.#config.apiKey, true),
          body: JSON.stringify({ fileName })
        },
        allowedHosts: [googleApiHost],
        maximumResponseBytes: 512 * 1024,
        retryMutation: false,
        fetcher: this.#config.fetcher,
        sleep: this.#config.sleep
      });
      operationName = asString(imported.value.name);
      if (!operationName) throw new Error("Gemini File Search import did not return an operation name");
      await this.#waitForOperation(operationName);
    }
    return makeReceipt({
      adapterId: "gemini",
      operation: "create",
      requestIdempotencyKey: request.idempotencyKey,
      authorization,
      grant,
      approvalRef: request.approvalRef,
      providerObjectId: fileName,
      providerVersion: asString(file.updateTime),
      status: "SUCCEEDED",
      evidence: {
        destination: request.destination,
        importOperation: operationName,
        importCompleted: operationName !== null,
        bytes: request.bytes.byteLength
      },
      clock: this.#config.clock
    });
  }

  async infer(request: InferenceRequest, grant: ActionGrant): Promise<InferenceResult> {
    const authorization = authorizeInference("gemini", request, grant, this.#policy);
    const storeNames = request.resourceRefs.map((name) => {
      if (!validStoreName(name)) throw new Error("Gemini inference resources must be allowlisted File Search store names");
      return this.#storeName(name);
    });
    const input: unknown = request.systemInstruction
      ? [
          { type: "text", text: `System instruction: ${request.systemInstruction}` },
          { type: "text", text: request.prompt }
        ]
      : request.prompt;
    const body: Record<string, unknown> = {
      model: this.#config.model ?? "gemini-3.7-flash",
      input,
      store: false
    };
    if (storeNames.length > 0) body.tools = [{ type: "file_search", file_search_store_names: storeNames }];
    const { value } = await adapterJson<Record<string, unknown>>({
      url: "https://generativelanguage.googleapis.com/v1beta/interactions",
      init: {
        method: "POST",
        headers: { ...apiHeaders(this.#config.apiKey, true), "Idempotency-Key": request.idempotencyKey },
        body: JSON.stringify(body)
      },
      allowedHosts: [googleApiHost],
      maximumResponseBytes: 8 * 1024 * 1024,
      retryMutation: false,
      timeoutMs: 360_000,
      fetcher: this.#config.fetcher,
      sleep: this.#config.sleep
    });
    const responseId = asString(value.id);
    const receipt = makeReceipt({
      adapterId: "gemini",
      operation: "inference",
      requestIdempotencyKey: request.idempotencyKey,
      authorization,
      grant,
      approvalRef: request.approvalRef,
      providerObjectId: responseId,
      providerVersion: asString(value.model) ?? this.#config.model ?? "gemini-3.7-flash",
      status: "SUCCEEDED",
      evidence: { store: false, fileSearchStoreCount: storeNames.length },
      clock: this.#config.clock
    });
    const outputText = extractText(value);
    if (!responseId || !outputText.trim()) throw new Error("Gemini inference response did not include an ID and non-empty output");
    return {
      receipt,
      outputText,
      providerResponseId: responseId,
      citations: extractAnnotations(value),
      rawSummary: toJsonObject({ id: responseId, model: value.model ?? null, usage: asRecord(value.usage) })
    };
  }
}

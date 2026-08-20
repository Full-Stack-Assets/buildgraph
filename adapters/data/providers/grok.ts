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
import { isoFromUnixSeconds, sha256Hex } from "../core.js";
import { authorizeInference, authorizeWrite, makeReceipt, type ActionPolicy } from "../authorization.js";
import { decodeCursor, encodeCursor } from "../cursor.js";
import { adapterJson, adapterRequest, classifyAdapterHealthError, type FetchLike, type Sleep } from "../http.js";
import { asArray, asNumber, asRecord, asString, extractAnnotations, extractText, toJsonObject } from "../json.js";

const apiHost = "api.x.ai";
const managementHost = "management-api.x.ai";

export type GrokDataAdapterConfig = {
  apiKey: string;
  managementApiKey?: string;
  collectionIds?: string[];
  model?: string;
  maximumItemBytes?: number;
  collectionPollIntervalMs?: number;
  collectionTimeoutMs?: number;
  actionPolicy?: Partial<ActionPolicy>;
  fetcher?: FetchLike;
  sleep?: Sleep;
  clock?: () => Date;
};

type GrokFile = {
  id?: unknown;
  filename?: unknown;
  bytes?: unknown;
  created_at?: unknown;
  expires_at?: unknown;
  purpose?: unknown;
};

function defaultPolicy(config: GrokDataAdapterConfig): ActionPolicy {
  return {
    writesEnabled: config.actionPolicy?.writesEnabled ?? false,
    inferenceEnabled: config.actionPolicy?.inferenceEnabled ?? false,
    requireApprovalFor: config.actionPolicy?.requireApprovalFor ?? ["update"],
    clock: config.actionPolicy?.clock ?? config.clock
  };
}

function bearer(value: string): HeadersInit {
  if (!value.trim()) throw new Error("Grok credential is not configured");
  return { Authorization: `Bearer ${value}` };
}

function parseFile(value: GrokFile): DataItem | null {
  const id = asString(value.id);
  const name = asString(value.filename);
  if (!id || !/^file_[A-Za-z0-9-]+$/.test(id) || !name) return null;
  const createdSeconds = asNumber(value.created_at);
  const createdAt = createdSeconds === null ? null : isoFromUnixSeconds(createdSeconds);
  const size = asNumber(value.bytes);
  return {
    adapterId: "grok",
    externalId: id,
    version: null,
    name,
    mimeType: "application/octet-stream",
    sizeBytes: size !== null && size >= 0 ? size : null,
    createdAt,
    modifiedAt: createdAt,
    contentHash: null,
    contentAvailability: "downloadable",
    deleted: false,
    sourceUri: `xai://files/${encodeURIComponent(id)}`,
    metadata: toJsonObject({ expiresAt: value.expires_at ?? null, purpose: value.purpose ?? null })
  };
}

function cursorString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export class GrokDataAdapter implements AIDataAdapter {
  readonly capabilities;
  readonly #config: GrokDataAdapterConfig;
  readonly #policy: ActionPolicy;

  constructor(config: GrokDataAdapterConfig) {
    const collectionIds = config.collectionIds ?? [];
    if (collectionIds.some((value) => !/^collection_[A-Za-z0-9-]+$/.test(value)) || new Set(collectionIds).size !== collectionIds.length) {
      throw new Error("Grok collection IDs must be unique valid collection identifiers");
    }
    if (!Number.isFinite(config.collectionPollIntervalMs ?? 1_000) || (config.collectionPollIntervalMs ?? 1_000) < 10) {
      throw new Error("Grok collectionPollIntervalMs must be at least 10ms");
    }
    if (!Number.isFinite(config.collectionTimeoutMs ?? 300_000) || (config.collectionTimeoutMs ?? 300_000) < 1_000) {
      throw new Error("Grok collectionTimeoutMs must be at least 1000ms");
    }
    this.#config = config;
    this.#policy = defaultPolicy(config);
    const maximumItemBytes = config.maximumItemBytes ?? 50 * 1024 * 1024;
    if (!Number.isSafeInteger(maximumItemBytes) || maximumItemBytes < 1 || maximumItemBytes > 64 * 1024 * 1024) {
      throw new Error("Grok maximumItemBytes must be from 1 through 67108864");
    }
    this.capabilities = {
      adapterId: "grok" as const,
      evidenceState: "TESTED" as const,
      operations: ["list", "read", "create", "inference"] as const,
      supportsIncrementalCursor: true,
      supportsContentDownload: true,
      supportsContinuousSync: true,
      maximumItemBytes,
      constraints: [
        "Connects to xAI API Files, Collections, and Responses resources, not private grok.com consumer chat history.",
        "Collection mutations require a separately scoped xAI Management API key.",
        "Update-in-place is intentionally disabled; new immutable file versions are uploaded instead."
      ]
    };
  }

  #collectionId(value: string): string {
    if (!/^collection_[A-Za-z0-9-]+$/.test(value)) throw new Error("Grok collection ID is invalid");
    const configured = this.#config.collectionIds;
    if (!configured?.includes(value)) {
      throw new Error("Grok collection is outside the deployment allowlist");
    }
    return value;
  }

  async #waitForCollectionDocument(collectionId: string, fileId: string): Promise<string> {
    const started = Date.now();
    const timeoutMs = this.#config.collectionTimeoutMs ?? 300_000;
    const sleep = this.#config.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    while (true) {
      const { value } = await adapterJson<Record<string, unknown>>({
        url: `https://management-api.x.ai/v1/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(fileId)}`,
        init: { headers: bearer(this.#config.managementApiKey ?? "") },
        allowedHosts: [managementHost],
        maximumResponseBytes: 512 * 1024,
        fetcher: this.#config.fetcher,
        sleep: this.#config.sleep
      });
      const status = asString(value.status);
      if (status === "DOCUMENT_STATUS_PROCESSED") return status;
      if (status === "DOCUMENT_STATUS_FAILED") throw new Error("Grok collection document processing failed");
      if (Date.now() - started >= timeoutMs) throw new Error("Grok collection document processing timed out");
      await sleep(this.#config.collectionPollIntervalMs ?? 1_000);
    }
  }

  async healthCheck(): Promise<AdapterHealth> {
    const started = Date.now();
    try {
      await adapterJson({
        url: "https://api.x.ai/v1/files?limit=1",
        init: { headers: bearer(this.#config.apiKey) },
        allowedHosts: [apiHost],
        maximumResponseBytes: 256 * 1024,
        fetcher: this.#config.fetcher,
        sleep: this.#config.sleep
      });
      let collectionsVerified = false;
      if (this.#config.managementApiKey) {
        const collections = this.#config.collectionIds ?? [];
        if (collections.length === 0) {
          await adapterJson({
            url: "https://management-api.x.ai/v1/collections?limit=1",
            init: { headers: bearer(this.#config.managementApiKey) },
            allowedHosts: [managementHost],
            maximumResponseBytes: 256 * 1024,
            fetcher: this.#config.fetcher,
            sleep: this.#config.sleep
          });
        } else {
          for (const collectionId of collections) {
            await adapterJson({
              url: `https://management-api.x.ai/v1/collections/${encodeURIComponent(this.#collectionId(collectionId))}`,
              init: { headers: bearer(this.#config.managementApiKey) },
              allowedHosts: [managementHost],
              maximumResponseBytes: 256 * 1024,
              fetcher: this.#config.fetcher,
              sleep: this.#config.sleep
            });
          }
        }
        collectionsVerified = true;
      }
      return {
        adapterId: "grok",
        status: collectionsVerified || !this.#config.collectionIds?.length ? "HEALTHY" : "DEGRADED",
        checkedAt: (this.#config.clock ?? (() => new Date()))().toISOString(),
        latencyMs: Date.now() - started,
        authenticated: true,
        readVerified: true,
        writeConfigured: this.#policy.writesEnabled,
        detail: collectionsVerified ? "Files and Collections credentials accepted." : "Files credential accepted; Collections not probed.",
        evidence: {
          files: "verified",
          collections: collectionsVerified ? "verified" : "not-configured",
          configuredCollectionCount: this.#config.collectionIds?.length ?? 0
        }
      };
    } catch (error) {
      return {
        adapterId: "grok",
        status: classifyAdapterHealthError(error),
        checkedAt: (this.#config.clock ?? (() => new Date()))().toISOString(),
        latencyMs: Date.now() - started,
        authenticated: false,
        readVerified: false,
        writeConfigured: this.#policy.writesEnabled,
        detail: error instanceof Error ? error.message : "Grok health probe failed.",
        evidence: {}
      };
    }
  }

  async listChanges(cursor: string | null): Promise<ChangePage> {
    const state = decodeCursor(cursor);
    const pageToken = cursorString(state.pageToken);
    const since = cursorString(state.since);
    const url = new URL("https://api.x.ai/v1/files");
    url.searchParams.set("limit", "100");
    url.searchParams.set("order", "asc");
    url.searchParams.set("sort_by", "created_at");
    if (pageToken) url.searchParams.set("pagination_token", pageToken);
    if (since) url.searchParams.set("filter", `created_at >= "${since}"`);

    const { value } = await adapterJson<Record<string, unknown>>({
      url,
      init: { headers: bearer(this.#config.apiKey) },
      allowedHosts: [apiHost],
      maximumResponseBytes: 2 * 1024 * 1024,
      fetcher: this.#config.fetcher,
      sleep: this.#config.sleep
    });
    const rawItems = asArray(value.data);
    const items = rawItems.map((item) => parseFile(item as GrokFile)).filter((item): item is DataItem => item !== null);
    const hasMore = rawItems.length === 100;
    const nextPageToken = hasMore ? cursorString(value.pagination_token) : null;
    if (hasMore && !nextPageToken) throw new Error("Grok Files page was full but did not include a pagination token");
    const maxSeen = items.reduce<string | null>((latest, item) => {
      if (!item.createdAt) return latest;
      return latest === null || item.createdAt > latest ? item.createdAt : latest;
    }, since);
    return {
      adapterId: "grok",
      observedAt: (this.#config.clock ?? (() => new Date()))().toISOString(),
      items,
      nextCursor: encodeCursor({
        pageToken: nextPageToken,
        since: nextPageToken ? since : maxSeen
      }),
      hasMore
    };
  }

  async read(item: DataItem): Promise<ReadResult> {
    if (item.adapterId !== "grok" || !/^file_[A-Za-z0-9-]+$/.test(item.externalId)) {
      throw new Error("Grok read item is outside the adapter namespace");
    }
    if (item.sizeBytes !== null && item.sizeBytes > this.capabilities.maximumItemBytes) {
      return { item, bytes: null, contentHash: item.contentHash, unavailableReason: "Grok file exceeds adapter maximumItemBytes." };
    }
    try {
      const { bytes } = await adapterRequest({
        url: `https://api.x.ai/v1/files/${encodeURIComponent(item.externalId)}/content`,
        init: { headers: bearer(this.#config.apiKey) },
        allowedHosts: [apiHost],
        maximumResponseBytes: this.capabilities.maximumItemBytes,
        fetcher: this.#config.fetcher,
        sleep: this.#config.sleep
      });
      return { item, bytes, contentHash: sha256Hex(bytes), unavailableReason: null };
    } catch (error) {
      if (error instanceof Error && error.message.includes("exceeded the configured byte limit")) {
        return { item, bytes: null, contentHash: item.contentHash, unavailableReason: "Grok file exceeds adapter maximumItemBytes." };
      }
      throw error;
    }
  }

  async write(request: WriteRequest, grant: ActionGrant) {
    if (request.operation !== "create") {
      throw new Error("Grok adapter requires immutable create operations; update-in-place is disabled");
    }
    if (request.bytes.byteLength > this.capabilities.maximumItemBytes) {
      throw new Error("Grok upload exceeds adapter maximumItemBytes");
    }
    const authorization = authorizeWrite("grok", request, grant, this.#policy);
    const collectionId = request.destination.startsWith("collection:")
      ? this.#collectionId(request.destination.slice("collection:".length))
      : null;
    const managementApiKey = this.#config.managementApiKey;
    if (collectionId === null && request.destination !== "file:new") {
      throw new Error("Grok destination must be file:new or an allowlisted collection:<id>");
    }
    if (collectionId && !managementApiKey) {
      throw new Error("Grok collection destination requires a management key");
    }
    const form = new FormData();
    form.append("file", new Blob([request.bytes.slice().buffer], { type: request.mimeType }), request.name);
    form.append("purpose", "assistants");
    const { value } = await adapterJson<Record<string, unknown>>({
      url: "https://api.x.ai/v1/files",
      init: {
        method: "POST",
        headers: { ...bearer(this.#config.apiKey), "Idempotency-Key": request.idempotencyKey },
        body: form
      },
      allowedHosts: [apiHost],
      maximumResponseBytes: 512 * 1024,
      retryMutation: false,
      fetcher: this.#config.fetcher,
      sleep: this.#config.sleep
    });
    const fileId = asString(value.id);
    if (!fileId) throw new Error("Grok upload response did not include a file ID");

    let collectionStatus: string | null = null;
    if (collectionId) {
      await adapterRequest({
        url: `https://management-api.x.ai/v1/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(fileId)}`,
        init: { method: "POST", headers: bearer(managementApiKey as string) },
        allowedHosts: [managementHost],
        maximumResponseBytes: 512 * 1024,
        retryMutation: false,
        fetcher: this.#config.fetcher,
        sleep: this.#config.sleep
      });
      collectionStatus = await this.#waitForCollectionDocument(collectionId, fileId);
    }

    return makeReceipt({
      adapterId: "grok",
      operation: "create",
      requestIdempotencyKey: request.idempotencyKey,
      authorization,
      grant,
      approvalRef: request.approvalRef,
      providerObjectId: fileId,
      providerVersion: null,
      status: "SUCCEEDED",
      evidence: { destination: request.destination, collectionStatus, bytes: request.bytes.byteLength },
      clock: this.#config.clock
    });
  }

  async infer(request: InferenceRequest, grant: ActionGrant): Promise<InferenceResult> {
    const authorization = authorizeInference("grok", request, grant, this.#policy);
    const collectionIds = request.resourceRefs.map((ref) => {
      if (!ref.startsWith("collection:")) throw new Error("Grok inference resources must be allowlisted collection:<id> references");
      return this.#collectionId(ref.slice("collection:".length));
    });
    const input: Array<Record<string, string>> = [];
    if (request.systemInstruction) input.push({ role: "system", content: request.systemInstruction });
    input.push({ role: "user", content: request.prompt });
    const body: Record<string, unknown> = {
      model: this.#config.model ?? "grok-4.6",
      input,
      store: false
    };
    if (collectionIds.length > 0) {
      body.tools = [{ type: "file_search", vector_store_ids: collectionIds, max_num_results: 10 }];
    }
    const { value } = await adapterJson<Record<string, unknown>>({
      url: "https://api.x.ai/v1/responses",
      init: {
        method: "POST",
        headers: { ...bearer(this.#config.apiKey), "Content-Type": "application/json", "Idempotency-Key": request.idempotencyKey },
        body: JSON.stringify(body)
      },
      allowedHosts: [apiHost],
      maximumResponseBytes: 8 * 1024 * 1024,
      retryMutation: false,
      timeoutMs: 360_000,
      fetcher: this.#config.fetcher,
      sleep: this.#config.sleep
    });
    const responseId = asString(value.id);
    const receipt = makeReceipt({
      adapterId: "grok",
      operation: "inference",
      requestIdempotencyKey: request.idempotencyKey,
      authorization,
      grant,
      approvalRef: request.approvalRef,
      providerObjectId: responseId,
      providerVersion: asString(value.model),
      status: "SUCCEEDED",
      evidence: { store: false, collectionCount: collectionIds.length },
      clock: this.#config.clock
    });
    const outputText = extractText(value);
    if (!responseId || !outputText.trim()) throw new Error("Grok inference response did not include an ID and non-empty output");
    return {
      receipt,
      outputText,
      providerResponseId: responseId,
      citations: extractAnnotations(value),
      rawSummary: toJsonObject({ id: responseId, model: value.model ?? null, usage: asRecord(value.usage) })
    };
  }
}

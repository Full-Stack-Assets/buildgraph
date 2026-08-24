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
import { sha256Hex, utf8 } from "../core.js";
import { authorizeInference, authorizeWrite, makeReceipt, type ActionPolicy } from "../authorization.js";
import { decodeCursor, encodeCursor } from "../cursor.js";
import { asArray, asIsoDate, asRecord, asString, extractText, toJsonObject, toJsonValue } from "../json.js";

export type CopilotSessionLike = {
  sessionId?: string;
  getEvents(): Promise<unknown[]>;
  sendAndWait(input: { prompt: string }, timeoutMs?: number): Promise<unknown>;
  disconnect?(): Promise<void>;
};

export type CopilotClientLike = {
  start?(): Promise<void>;
  stop(): Promise<unknown>;
  ping?(message?: string): Promise<unknown>;
  listSessions(filter?: Record<string, unknown>): Promise<unknown>;
  createSession(options: Record<string, unknown>): Promise<CopilotSessionLike>;
  resumeSession(sessionId: string, options?: Record<string, unknown>): Promise<CopilotSessionLike>;
};

export type CopilotDataAdapterConfig = {
  clientFactory?: (options?: Record<string, unknown>) => Promise<CopilotClientLike>;
  baseDirectory?: string;
  model?: string;
  workingDirectory?: string;
  maximumEventBytes?: number;
  responseTimeoutMs?: number;
  actionPolicy?: Partial<ActionPolicy>;
  clock?: () => Date;
};

type CopilotModule = { CopilotClient: new (options?: Record<string, unknown>) => CopilotClientLike };

export async function loadCopilotClient(options: Record<string, unknown> = {}): Promise<CopilotClientLike> {
  const packageName = "@github/copilot-sdk";
  let loaded: unknown;
  try {
    loaded = await import(packageName);
  } catch {
    throw new Error("GitHub Copilot SDK is not installed; install @github/copilot-sdk and authenticate Copilot CLI for this deployment");
  }
  const module = loaded as Partial<CopilotModule>;
  if (typeof module.CopilotClient !== "function") throw new Error("GitHub Copilot SDK did not expose CopilotClient");
  return new module.CopilotClient(options);
}

function defaultPolicy(config: CopilotDataAdapterConfig): ActionPolicy {
  return {
    writesEnabled: config.actionPolicy?.writesEnabled ?? false,
    inferenceEnabled: config.actionPolicy?.inferenceEnabled ?? false,
    requireApprovalFor: config.actionPolicy?.requireApprovalFor ?? ["update"],
    clock: config.actionPolicy?.clock ?? config.clock
  };
}

function denyToolsSessionOptions(config: CopilotDataAdapterConfig): Record<string, unknown> {
  return {
    model: config.model ?? "auto",
    ...(config.workingDirectory ? { workingDirectory: config.workingDirectory } : {}),
    enableSessionStore: true,
    tools: [],
    availableTools: [],
    onPermissionRequest: async () => ({ kind: "reject", feedback: "Canon adapter sessions do not authorize tool execution." }),
    hooks: {
      onPreToolUse: async () => ({
        permissionDecision: "deny",
        permissionDecisionReason: "Canon Copilot adapter sessions are conversation-only; external tools require a separate scoped integration."
      })
    }
  };
}

function sessionRecords(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  return asArray(record.sessions).length > 0 ? asArray(record.sessions) : asArray(record.items);
}

function sessionItem(value: unknown): DataItem | null {
  if (typeof value === "string") {
    return {
      adapterId: "copilot",
      externalId: value,
      version: null,
      name: value,
      mimeType: "application/vnd.github.copilot.session+json",
      sizeBytes: null,
      createdAt: null,
      modifiedAt: null,
      contentHash: null,
      contentAvailability: "session-events",
      deleted: false,
      sourceUri: `copilot://sessions/${encodeURIComponent(value)}`,
      metadata: {}
    };
  }
  const record = asRecord(value);
  const id = asString(record.sessionId) ?? asString(record.id);
  if (!id || !/^[A-Za-z0-9._:-]{1,180}$/.test(id)) return null;
  const createdAt = asIsoDate(record.startTime) ?? asIsoDate(record.createdAt);
  const modifiedAt = asIsoDate(record.modifiedTime) ?? asIsoDate(record.updatedAt) ?? asIsoDate(record.modifiedAt);
  return {
    adapterId: "copilot",
    externalId: id,
    version: modifiedAt,
    name: (asString(record.summary) ?? asString(record.name) ?? asString(record.title) ?? id).slice(0, 1_024),
    mimeType: "application/vnd.github.copilot.session+json",
    sizeBytes: null,
    createdAt,
    modifiedAt,
    contentHash: null,
    contentAvailability: "session-events",
    deleted: false,
    sourceUri: `copilot://sessions/${encodeURIComponent(id)}`,
    metadata: toJsonObject({
      startTime: createdAt,
      modifiedTime: modifiedAt,
      isRemote: record.isRemote ?? null,
      context: toJsonValue(record.context ?? null)
    })
  };
}

function safeSessionId(value: string): string {
  if (!/^[A-Za-z0-9._:-]{1,180}$/.test(value)) throw new Error("Copilot session ID contains unsupported characters");
  return value;
}

export class CopilotDataAdapter implements AIDataAdapter {
  readonly capabilities;
  readonly #config: CopilotDataAdapterConfig;
  readonly #policy: ActionPolicy;

  constructor(config: CopilotDataAdapterConfig = {}) {
    if (!Number.isFinite(config.responseTimeoutMs ?? 360_000) || (config.responseTimeoutMs ?? 360_000) < 1_000) {
      throw new Error("Copilot responseTimeoutMs must be at least 1000ms");
    }
    const maximumEventBytes = config.maximumEventBytes ?? 16 * 1024 * 1024;
    if (!Number.isSafeInteger(maximumEventBytes) || maximumEventBytes < 1 || maximumEventBytes > 64 * 1024 * 1024) {
      throw new Error("Copilot maximumEventBytes must be from 1 through 67108864");
    }
    this.#config = config;
    this.#policy = defaultPolicy(config);
    this.capabilities = {
      adapterId: "copilot" as const,
      evidenceState: "TESTED" as const,
      operations: ["list", "read", "create", "update", "inference"] as const,
      supportsIncrementalCursor: true,
      supportsContentDownload: true,
      supportsContinuousSync: true,
      maximumItemBytes: maximumEventBytes,
      constraints: [
        "Covers GitHub Copilot SDK/CLI sessions exposed by the SDK, not every Copilot Chat surface or private IDE history.",
        "All built-in and custom tool execution is denied in adapter-managed sessions unless a separate integration is explicitly implemented.",
        "Copilot CLI authentication and an eligible Copilot subscription are deployment prerequisites."
      ]
    };
  }

  async #withClient<T>(operation: (client: CopilotClientLike) => Promise<T>): Promise<T> {
    const client = await (this.#config.clientFactory ?? loadCopilotClient)({
      mode: "empty",
      ...(this.#config.baseDirectory ? { baseDirectory: this.#config.baseDirectory } : {}),
      ...(this.#config.workingDirectory ? { workingDirectory: this.#config.workingDirectory } : {})
    });
    let result: T | undefined;
    let primaryError: unknown;
    try {
      await client.start?.();
      result = await operation(client);
    } catch (error) {
      primaryError = error;
    }
    let cleanupError: unknown;
    try {
      const errors = await client.stop();
      if (Array.isArray(errors) && errors.length > 0) cleanupError = new Error("Copilot SDK reported one or more cleanup failures");
    } catch (error) {
      cleanupError = error;
    }
    if (primaryError !== undefined) throw primaryError;
    if (cleanupError !== undefined) throw cleanupError;
    return result as T;
  }

  async healthCheck(): Promise<AdapterHealth> {
    const started = Date.now();
    try {
      const evidence = await this.#withClient(async (client) => {
        const ping = await client.ping?.("canon-health-check");
        const count = sessionRecords(await client.listSessions()).length;
        return { count, pinged: ping !== undefined };
      });
      return {
        adapterId: "copilot",
        status: "HEALTHY",
        checkedAt: (this.#config.clock ?? (() => new Date()))().toISOString(),
        latencyMs: Date.now() - started,
        authenticated: true,
        readVerified: true,
        writeConfigured: this.#policy.writesEnabled,
        detail: "Copilot SDK session store is reachable.",
        evidence: { sessionCount: evidence.count, ping: evidence.pinged ? "verified" : "sdk-method-unavailable", tools: "deny-by-default" }
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Copilot health probe failed.";
      const dependencyUnavailable = /Copilot SDK is not installed|did not expose CopilotClient/i.test(detail);
      const unauthenticated = !dependencyUnavailable && /auth|credential|subscription|\b401\b|\b403\b/i.test(detail);
      return {
        adapterId: "copilot",
        status: unauthenticated ? "UNAUTHENTICATED" : "UNREACHABLE",
        checkedAt: (this.#config.clock ?? (() => new Date()))().toISOString(),
        latencyMs: Date.now() - started,
        authenticated: false,
        readVerified: false,
        writeConfigured: this.#policy.writesEnabled,
        detail,
        evidence: {}
      };
    }
  }

  async listChanges(cursor: string | null = null): Promise<ChangePage> {
    const state = decodeCursor(cursor);
    const since = asIsoDate(state.since);
    const boundaryIds = new Set(asArray(state.boundaryIds).map(asString).filter((value): value is string => value !== null));
    const listed = await this.#withClient(async (client) =>
      sessionRecords(await client.listSessions()).map(sessionItem).filter((item): item is DataItem => item !== null)
    );
    const items = since
      ? listed.filter((item) => !item.modifiedAt || item.modifiedAt > since || (
          item.modifiedAt === since
          && !boundaryIds.has(item.externalId)
          && !boundaryIds.has(sha256Hex(utf8(item.externalId)))
        ))
      : listed;
    const maxSeen = listed.reduce<string | null>((latest, item) => {
      if (!item.modifiedAt) return latest;
      return latest === null || item.modifiedAt > latest ? item.modifiedAt : latest;
    }, since);
    const nextBoundaryIds = maxSeen
      ? listed
          .filter((item) => item.modifiedAt === maxSeen)
          .map((item) => sha256Hex(utf8(item.externalId)))
          .slice(0, 128)
      : [];
    return {
      adapterId: "copilot",
      observedAt: (this.#config.clock ?? (() => new Date()))().toISOString(),
      items,
      nextCursor: encodeCursor({ since: maxSeen, boundaryIds: nextBoundaryIds }),
      hasMore: false
    };
  }

  async read(item: DataItem): Promise<ReadResult> {
    if (item.adapterId !== "copilot") throw new Error("Copilot read item is outside the adapter namespace");
    const sessionId = safeSessionId(item.externalId);
    const events = await this.#withClient(async (client) => {
      const session = await client.resumeSession(sessionId, denyToolsSessionOptions(this.#config));
      try {
        return await session.getEvents();
      } finally {
        await session.disconnect?.();
      }
    });
    const bytes = utf8(JSON.stringify(events));
    if (bytes.byteLength > this.capabilities.maximumItemBytes) {
      return { item, bytes: null, contentHash: item.contentHash, unavailableReason: "Copilot session export exceeds adapter maximumItemBytes." };
    }
    return { item, bytes, contentHash: sha256Hex(bytes), unavailableReason: null };
  }

  async #sendPrompt(sessionId: string | null, prompt: string): Promise<{ sessionId: string | null; response: unknown; events: unknown[] }> {
    return this.#withClient(async (client) => {
      const options = denyToolsSessionOptions(this.#config);
      const session = sessionId
        ? await client.resumeSession(safeSessionId(sessionId), options)
        : await client.createSession(options);
      try {
        const response = await session.sendAndWait({ prompt }, this.#config.responseTimeoutMs ?? 360_000);
        const events = await session.getEvents();
        const eventBytes = utf8(JSON.stringify({ response, events }));
        if (eventBytes.byteLength > this.capabilities.maximumItemBytes) {
          throw new Error("Copilot response and session events exceed adapter maximumItemBytes");
        }
        return { sessionId: session.sessionId ?? sessionId, response, events };
      } finally {
        await session.disconnect?.();
      }
    });
  }

  async write(request: WriteRequest, grant: ActionGrant) {
    if (request.bytes.byteLength > this.capabilities.maximumItemBytes) {
      throw new Error("Copilot prompt exceeds adapter maximumItemBytes");
    }
    const authorization = authorizeWrite("copilot", request, grant, this.#policy);
    if (!request.mimeType.startsWith("text/") && request.mimeType !== "application/json") {
      throw new Error("Copilot session writes accept text content only");
    }
    const prompt = new TextDecoder("utf-8", { fatal: true }).decode(request.bytes);
    const requestedSession = request.destination === "session:new"
      ? null
      : request.destination.startsWith("session:")
        ? request.destination.slice("session:".length)
        : null;
    if (request.destination !== "session:new" && requestedSession === null) {
      throw new Error("Copilot destination must be session:new or session:<id>");
    }
    if (request.operation === "create" && requestedSession !== null) {
      throw new Error("Copilot create operations require session:new");
    }
    if (request.operation === "update" && requestedSession === null) {
      throw new Error("Copilot update operations require session:<id>");
    }
    const sent = await this.#sendPrompt(requestedSession, prompt);
    if (!sent.sessionId) throw new Error("Copilot write did not return a session ID");
    return makeReceipt({
      adapterId: "copilot",
      operation: request.operation,
      requestIdempotencyKey: request.idempotencyKey,
      authorization,
      grant,
      approvalRef: request.approvalRef,
      providerObjectId: sent.sessionId,
      providerVersion: null,
      status: "SUCCEEDED",
      evidence: { tools: "denied", eventCount: sent.events.length },
      clock: this.#config.clock
    });
  }

  async infer(request: InferenceRequest, grant: ActionGrant): Promise<InferenceResult> {
    const authorization = authorizeInference("copilot", request, grant, this.#policy);
    if (request.resourceRefs.length !== 1 || !request.resourceRefs[0]?.startsWith("session:")) {
      throw new Error("Copilot inference requires exactly one session:new or session:<id> resource");
    }
    const sessionRef = request.resourceRefs[0].slice("session:".length);
    const requestedSession = sessionRef === "new" ? null : safeSessionId(sessionRef);
    const prompt = request.systemInstruction ? `${request.systemInstruction}\n\n${request.prompt}` : request.prompt;
    const sent = await this.#sendPrompt(requestedSession, prompt);
    const receipt = makeReceipt({
      adapterId: "copilot",
      operation: "inference",
      requestIdempotencyKey: request.idempotencyKey,
      authorization,
      grant,
      approvalRef: request.approvalRef,
      providerObjectId: sent.sessionId,
      providerVersion: this.#config.model ?? "auto",
      status: "SUCCEEDED",
      evidence: { tools: "denied", eventCount: sent.events.length },
      clock: this.#config.clock
    });
    const outputText = extractText(sent.response) || extractText({ steps: sent.events });
    if (!sent.sessionId || !outputText.trim()) throw new Error("Copilot inference did not return a session ID and non-empty output");
    return {
      receipt,
      outputText,
      providerResponseId: sent.sessionId,
      citations: [],
      rawSummary: toJsonObject({
        sessionId: sent.sessionId,
        responseType: asString(asRecord(sent.response).type),
        eventCount: sent.events.length
      })
    };
  }
}

import { randomUUID, timingSafeEqual } from "node:crypto";
import type { AdapterId, DataItem, JsonObject, ReadResult } from "./core.js";
import { sha256Hex, utf8 } from "./core.js";
import type {
  AutonomousInferenceEvidence,
  InferenceEvidenceStore,
  RetrievalJobState,
  RetrievalStateStore
} from "./retrieval-agent.js";
import type {
  CanonSink,
  CheckpointStore,
  DeadLetter,
  DeadLetterStore,
  IngestReceipt,
  SyncCheckpoint
} from "./storage.js";

type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
  bucket: string;
  maximumItemBytes: number;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required environment variable ${name}`);
  return value;
}

function config(): SupabaseConfig {
  const maximumItemBytes = Number(process.env.SUPABASE_MAX_ITEM_BYTES ?? "67108864");
  if (!Number.isSafeInteger(maximumItemBytes) || maximumItemBytes < 1 || maximumItemBytes > 64 * 1024 * 1024) {
    throw new Error("SUPABASE_MAX_ITEM_BYTES must be an integer from 1 through 67108864");
  }
  return {
    url: requiredEnv("SUPABASE_URL").replace(/\/$/, ""),
    serviceRoleKey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    bucket: process.env.SUPABASE_STORAGE_BUCKET?.trim() || "canon-objects",
    maximumItemBytes
  };
}

function encoded(value: string): string {
  return encodeURIComponent(value);
}

function pathWithFilters(table: string, filters: Record<string, string>): string {
  const query = Object.entries(filters).map(([key, value]) => `${key}=eq.${encoded(value)}`).join("&");
  return `/rest/v1/${table}?${query}`;
}

export class SupabaseAdapterError extends Error {
  readonly status: number;
  readonly diagnostic: string | null;
  constructor(message: string, status: number, diagnostic: string | null = null) {
    super(message);
    this.name = "SupabaseAdapterError";
    this.status = status;
    this.diagnostic = diagnostic;
  }
}

function safeSupabaseDiagnostic(text: string): string | null {
  if (!text) return null;
  let value = text;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      value = [record.code, record.message, record.details, record.hint]
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .join(": ");
    }
  } catch {
    // PostgREST normally returns JSON, but a bounded plain-text response is still useful.
  }
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("").slice(0, 2_048) || null;
}

export class SupabaseClient {
  readonly #config: SupabaseConfig;
  constructor(input?: SupabaseConfig) { this.#config = input ?? config(); }

  async rest(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch(`${this.#config.url}${path}`, {
      ...init,
      headers: {
        apikey: this.#config.serviceRoleKey,
        Authorization: `Bearer ${this.#config.serviceRoleKey}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...(init.headers ?? {})
      }
    });
    const text = await response.text();
    if (!response.ok) {
      const diagnostic = safeSupabaseDiagnostic(text);
      throw new SupabaseAdapterError(
        `Supabase request failed (${response.status})${diagnostic ? `: ${diagnostic}` : ""}`,
        response.status,
        diagnostic
      );
    }
    if (!text) return null;
    try { return JSON.parse(text) as unknown; } catch { return text; }
  }

  async storage(path: string, init: RequestInit = {}): Promise<Uint8Array> {
    const response = await fetch(`${this.#config.url}/storage/v1/object/${this.#config.bucket}/${path}`, {
      ...init,
      headers: {
        apikey: this.#config.serviceRoleKey,
        Authorization: `Bearer ${this.#config.serviceRoleKey}`,
        ...(init.headers ?? {})
      }
    });
    if (!response.ok) throw new SupabaseAdapterError(`Supabase storage request failed (${response.status})`, response.status);
    return new Uint8Array(await response.arrayBuffer());
  }

  get bucket(): string { return this.#config.bucket; }
  get maximumItemBytes(): number { return this.#config.maximumItemBytes; }
}

function arrayValue(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Supabase response was not an array");
  return value;
}

type SupabaseStoredRecord = {
  source: DataItem;
  content: { hashSha256: string | null; objectPath: string | null; unavailableReason: string | null };
  provenance: { firstObservedAt: string; lastObservedAt: string; lastRunId: string };
};

type SupabaseStoredRow = {
  source: DataItem;
  content: SupabaseStoredRecord["content"];
  first_observed_at: string;
  last_observed_at: string;
  last_run_id: string;
};

function existingRecord(value: unknown): SupabaseStoredRecord | null {
  const rows = arrayValue(value);
  if (rows.length === 0) return null;
  const row = rows[0];
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("invalid Supabase Canon record");
  const record = row as Partial<SupabaseStoredRow> & Record<string, unknown>;
  if (!record.source || !record.content
    || typeof record.first_observed_at !== "string"
    || typeof record.last_observed_at !== "string"
    || typeof record.last_run_id !== "string") {
    throw new Error("invalid Supabase Canon record");
  }
  return {
    source: record.source,
    content: record.content,
    provenance: {
      firstObservedAt: record.first_observed_at,
      lastObservedAt: record.last_observed_at,
      lastRunId: record.last_run_id
    }
  };
}

export class SupabaseCheckpointStore implements CheckpointStore {
  readonly #client: SupabaseClient;
  constructor(client = new SupabaseClient()) { this.#client = client; }
  async get(adapterId: AdapterId): Promise<SyncCheckpoint | null> {
    const value = await this.#client.rest(pathWithFilters("canon_sync_checkpoints", { adapter_id: adapterId }));
    const rows = arrayValue(value);
    if (rows.length === 0) return null;
    const row = rows[0] as Partial<SyncCheckpoint> & { adapter_id?: string; last_run_id?: string; updated_at?: string };
    if (row.adapter_id !== adapterId || typeof row.updated_at !== "string" || typeof row.last_run_id !== "string") {
      throw new Error(`invalid Supabase checkpoint for ${adapterId}`);
    }
    return { adapterId, cursor: row.cursor ?? null, updatedAt: row.updated_at, lastRunId: row.last_run_id };
  }
  async put(checkpoint: SyncCheckpoint): Promise<void> {
    await this.#client.rest("/rest/v1/canon_sync_checkpoints", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        adapter_id: checkpoint.adapterId,
        cursor: checkpoint.cursor,
        updated_at: checkpoint.updatedAt,
        last_run_id: checkpoint.lastRunId
      })
    });
  }
}

export class SupabaseCanonSink implements CanonSink {
  readonly #client: SupabaseClient;
  constructor(client = new SupabaseClient()) { this.#client = client; }

  async ingest(runId: string, item: DataItem, result: ReadResult, observedAt: string): Promise<IngestReceipt> {
    if (result.item.adapterId !== item.adapterId || result.item.externalId !== item.externalId) {
      throw new Error("read result identity does not match the listed source item");
    }
    if (result.bytes && result.bytes.byteLength > this.#client.maximumItemBytes) throw new Error("ingested item exceeds Supabase sink maximumItemBytes");
    const externalIdHash = sha256Hex(utf8(`${item.adapterId}\0${item.externalId}`));
    const computedContentHash = result.bytes ? sha256Hex(result.bytes) : null;
    if (computedContentHash && result.contentHash && computedContentHash !== result.contentHash) throw new Error("read result content hash does not match its bytes");
    const contentHash = computedContentHash ?? result.contentHash;
    const objectPath = contentHash ? `${contentHash.slice(0, 2)}/${contentHash}` : null;
    if (objectPath && result.bytes) {
      try {
        await this.#client.storage(objectPath, { method: "POST", headers: { "content-type": item.mimeType, "x-upsert": "false" }, body: result.bytes as unknown as BodyInit });
      } catch (error) {
        if (!(error instanceof SupabaseAdapterError && (error.status === 400 || error.status === 409))) throw error;
        const existing = await this.#client.storage(objectPath);
        if (existing.byteLength !== result.bytes.byteLength || !timingSafeEqual(existing, result.bytes)) throw new Error("content-addressed Supabase object differs from the incoming bytes");
      }
    }
    const existingValue = await this.#client.rest(pathWithFilters("canon_ingested_records", { adapter_id: item.adapterId, external_id_hash: externalIdHash }));
    const existing = existingRecord(existingValue);
    const same = existing?.source.version === item.version && existing.content.hashSha256 === contentHash && existing.source.deleted === item.deleted;
    const status: IngestReceipt["status"] = item.deleted ? "TOMBSTONED" : same ? "UNCHANGED" : existing ? "UPDATED" : "CREATED";
    const recordPath = `supabase://canon_ingested_records/${item.adapterId}/${externalIdHash}`;
    const record = {
      adapter_id: item.adapterId,
      external_id_hash: externalIdHash,
      source: { ...item, contentHash } as unknown as JsonObject,
      content: { hashSha256: contentHash, objectPath: objectPath ? `supabase://${this.#client.bucket}/${objectPath}` : null, unavailableReason: result.unavailableReason },
      first_observed_at: existing?.provenance.firstObservedAt ?? observedAt,
      last_observed_at: observedAt,
      last_run_id: runId
    };
    await this.#client.rest("/rest/v1/canon_ingested_records", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(record) });
    const receipt: IngestReceipt = { receiptId: `ingest-${randomUUID()}`, runId, adapterId: item.adapterId, externalIdHash, contentHash, recordPath, objectPath: objectPath ? `supabase://${this.#client.bucket}/${objectPath}` : null, status, observedAt };
    await this.#client.rest("/rest/v1/canon_ingest_receipts", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ receipt_id: receipt.receiptId, run_id: runId, adapter_id: item.adapterId, external_id_hash: externalIdHash, content_hash: contentHash, record_path: recordPath, object_path: receipt.objectPath, status, observed_at: observedAt }) });
    return receipt;
  }
}

export class SupabaseDeadLetterStore implements DeadLetterStore {
  readonly #client: SupabaseClient;
  constructor(client = new SupabaseClient()) { this.#client = client; }
  async put(letter: DeadLetter): Promise<void> {
    await this.#client.rest("/rest/v1/canon_dead_letters", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        run_id: letter.runId,
        adapter_id: letter.adapterId,
        external_id_hash: letter.externalIdHash,
        phase: letter.phase,
        occurred_at: letter.occurredAt,
        error_class: letter.errorClass,
        message: letter.message,
        retryable: letter.retryable
      })
    });
  }
}

export type SupabaseRunReceiptStore = {
  putSync(value: unknown): Promise<void>;
  putRetrieval(value: unknown): Promise<void>;
};

export class SupabaseRunStore implements SupabaseRunReceiptStore {
  readonly #client: SupabaseClient;
  constructor(client = new SupabaseClient()) { this.#client = client; }
  async putSync(value: unknown): Promise<void> { await this.#client.rest("/rest/v1/canon_sync_runs", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ run_id: typeof value === "object" && value !== null && "runId" in value ? (value as { runId: string }).runId : randomUUID(), receipt: value }) }); }
  async putRetrieval(value: unknown): Promise<void> { await this.#client.rest("/rest/v1/canon_retrieval_runs", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ run_id: typeof value === "object" && value !== null && "runId" in value ? (value as { runId: string }).runId : randomUUID(), receipt: value }) }); }
}

export class SupabaseRetrievalStateStore implements RetrievalStateStore {
  readonly #client: SupabaseClient;
  constructor(client = new SupabaseClient()) { this.#client = client; }
  async get(jobId: string): Promise<RetrievalJobState | null> {
    const rows = arrayValue(await this.#client.rest(pathWithFilters("canon_retrieval_states", { job_id: jobId })));
    if (rows.length === 0) return null;
    const row = rows[0] as RetrievalJobState & { last_attempt_at: string; last_completed_at: string | null; last_status: RetrievalJobState["lastStatus"]; last_run_id: string; last_evidence_hash: string | null };
    return { jobId, lastAttemptAt: row.last_attempt_at, lastCompletedAt: row.last_completed_at, lastStatus: row.last_status, lastRunId: row.last_run_id, lastEvidenceHash: row.last_evidence_hash };
  }
  async put(state: RetrievalJobState): Promise<void> {
    await this.#client.rest("/rest/v1/canon_retrieval_states", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ job_id: state.jobId, last_attempt_at: state.lastAttemptAt, last_completed_at: state.lastCompletedAt, last_status: state.lastStatus, last_run_id: state.lastRunId, last_evidence_hash: state.lastEvidenceHash }) });
  }
}

export class SupabaseInferenceEvidenceStore implements InferenceEvidenceStore {
  readonly #client: SupabaseClient;
  readonly #maximumBytes: number;
  constructor(client = new SupabaseClient(), maximumBytes = 8 * 1024 * 1024) { this.#client = client; this.#maximumBytes = maximumBytes; }
  async put(evidence: AutonomousInferenceEvidence): Promise<string> {
    const bytes = utf8(`${JSON.stringify(evidence, null, 2)}\n`);
    if (bytes.byteLength > this.#maximumBytes) throw new Error("autonomous inference evidence exceeds the configured byte limit");
    const hash = sha256Hex(bytes);
    const objectPath = `inference/${evidence.jobId}/${evidence.runId}.json`;
    await this.#client.storage(objectPath, { method: "POST", headers: { "content-type": "application/json", "x-upsert": "false" }, body: bytes as unknown as BodyInit }).catch(async (error: unknown) => {
      if (!(error instanceof SupabaseAdapterError && (error.status === 400 || error.status === 409))) throw error;
      const existing = await this.#client.storage(objectPath);
      if (existing.byteLength !== bytes.byteLength || !timingSafeEqual(existing, bytes)) throw new Error("inference evidence object differs from incoming bytes");
    });
    return hash;
  }
}

export class SupabaseLease {
  readonly #client: SupabaseClient;
  readonly #name: string;
  readonly #ownerId: string;
  private constructor(client: SupabaseClient, name: string, ownerId: string) { this.#client = client; this.#name = name; this.#ownerId = ownerId; }
  static async acquire(name: string, ttlMs = 10 * 60_000, client = new SupabaseClient()): Promise<SupabaseLease> {
    if (!/^[A-Za-z0-9._-]{3,128}$/.test(name)) throw new Error("Supabase lease name is invalid");
    const ownerId = randomUUID();
    const result = await client.rest("/rest/v1/rpc/acquire_canon_lease", { method: "POST", body: JSON.stringify({ p_name: name, p_owner_id: ownerId, p_ttl_seconds: Math.ceil(ttlMs / 1000) }) });
    if (result !== true && !(Array.isArray(result) && result[0] === true)) throw new Error(`another ${name} run holds the active lease`);
    return new SupabaseLease(client, name, ownerId);
  }
  async release(): Promise<void> { await this.#client.rest("/rest/v1/rpc/release_canon_lease", { method: "POST", body: JSON.stringify({ p_name: this.#name, p_owner_id: this.#ownerId }) }); }
}

import { randomUUID } from "node:crypto";
import type { ActionGrant, AdapterId, AIDataAdapter, DataAdapter, InferenceRequest, InferenceResult, JsonValue } from "./core.js";
import { isAIDataAdapter, sha256Hex, utf8 } from "./core.js";
import { durableAtomicJson, readJsonFile, safeStoredMessage, validateStorageRoot, withinStorageRoot } from "./file-store.js";

export type AutonomousRetrievalJob = {
  jobId: string;
  adapterId: AdapterId;
  intervalMs: number;
  request: InferenceRequest;
  grant: ActionGrant;
};

export type RetrievalJobState = {
  jobId: string;
  lastAttemptAt: string;
  lastCompletedAt: string | null;
  lastStatus: "SUCCEEDED" | "FAILED";
  lastRunId: string;
  lastEvidenceHash: string | null;
};

export type AutonomousInferenceEvidence = {
  schemaVersion: "aoc.canon.autonomous-inference-evidence/v1";
  runId: string;
  jobId: string;
  adapterId: AdapterId;
  promptSha256: string;
  resourceRefs: string[];
  outputText: string;
  outputSha256: string;
  citations: JsonValue[];
  providerResult: InferenceResult;
  completedAt: string;
};

export type AutonomousRetrievalRunReceipt = {
  runId: string;
  jobId: string;
  adapterId: AdapterId;
  status: "SUCCEEDED" | "FAILED" | "SKIPPED";
  startedAt: string;
  completedAt: string;
  providerReceiptId: string | null;
  evidenceHash: string | null;
  error: string | null;
};

export interface RetrievalStateStore {
  get(jobId: string): Promise<RetrievalJobState | null>;
  put(state: RetrievalJobState): Promise<void>;
}

export interface InferenceEvidenceStore {
  put(evidence: AutonomousInferenceEvidence): Promise<string>;
}

function validateJob(job: AutonomousRetrievalJob): void {
  if (!/^[A-Za-z0-9._-]{3,128}$/.test(job.jobId)) throw new Error("retrieval jobId contains unsupported characters");
  if (!Number.isSafeInteger(job.intervalMs) || job.intervalMs < 60_000 || job.intervalMs > 2_592_000_000) {
    throw new Error("retrieval job interval must be an integer from 60000 through 2592000000ms");
  }
  if (job.grant.adapterId !== job.adapterId || !job.grant.operations.includes("inference")) {
    throw new Error("retrieval job grant is not bound to inference on the selected adapter");
  }
  if (!job.request.prompt.trim() || !job.request.idempotencyKey.trim()) throw new Error("retrieval job request is incomplete");
  if (job.request.resourceRefs.length === 0 || new Set(job.request.resourceRefs).size !== job.request.resourceRefs.length) {
    throw new Error("retrieval job resources must be non-empty and unique");
  }
}

function safeError(error: unknown): string {
  return safeStoredMessage(error);
}

export class AutonomousRetrievalAgent {
  readonly #adapters: Map<AdapterId, AIDataAdapter>;
  readonly #state: RetrievalStateStore;
  readonly #evidence: InferenceEvidenceStore;
  readonly #clock: () => Date;

  constructor(input: {
    adapters: DataAdapter[];
    stateStore: RetrievalStateStore;
    evidenceStore: InferenceEvidenceStore;
    clock?: () => Date;
  }) {
    this.#adapters = new Map(
      input.adapters.filter(isAIDataAdapter).map((adapter) => [adapter.capabilities.adapterId, adapter])
    );
    this.#state = input.stateStore;
    this.#evidence = input.evidenceStore;
    this.#clock = input.clock ?? (() => new Date());
  }

  async runDue(jobs: AutonomousRetrievalJob[], signal?: AbortSignal): Promise<AutonomousRetrievalRunReceipt[]> {
    const unique = new Set<string>();
    for (const job of jobs) {
      validateJob(job);
      if (unique.has(job.jobId)) throw new Error(`duplicate retrieval jobId ${job.jobId}`);
      unique.add(job.jobId);
    }
    const receipts: AutonomousRetrievalRunReceipt[] = [];
    for (const job of jobs) {
      if (signal?.aborted) break;
      const state = await this.#state.get(job.jobId);
      const now = this.#clock();
      if (state && new Date(state.lastAttemptAt).valueOf() + job.intervalMs > now.valueOf()) {
        receipts.push({
          runId: `retrieval-${randomUUID()}`,
          jobId: job.jobId,
          adapterId: job.adapterId,
          status: "SKIPPED",
          startedAt: now.toISOString(),
          completedAt: now.toISOString(),
          providerReceiptId: null,
          evidenceHash: state.lastEvidenceHash,
          error: null
        });
        continue;
      }
      receipts.push(await this.#run(job, state));
    }
    return receipts;
  }

  async #run(job: AutonomousRetrievalJob, previous: RetrievalJobState | null): Promise<AutonomousRetrievalRunReceipt> {
    const runId = `retrieval-${randomUUID()}`;
    const startedAt = this.#clock().toISOString();
    const adapter = this.#adapters.get(job.adapterId);
    let evidenceHash: string | null = null;
    let providerReceiptId: string | null = null;
    let errorMessage: string | null = null;
    let completedSuccessfully = false;
    try {
      if (!adapter) throw new Error(`adapter ${job.adapterId} does not support governed inference`);
      const cadenceSlot = Math.floor(new Date(startedAt).valueOf() / job.intervalMs);
      const request: InferenceRequest = {
        ...job.request,
        idempotencyKey: sha256Hex(utf8(`${job.request.idempotencyKey}\0${job.jobId}\0${cadenceSlot}`))
      };
      const result = await adapter.infer(request, job.grant);
      providerReceiptId = result.receipt.receiptId;
      const completedAt = this.#clock().toISOString();
      const evidence: AutonomousInferenceEvidence = {
        schemaVersion: "aoc.canon.autonomous-inference-evidence/v1",
        runId,
        jobId: job.jobId,
        adapterId: job.adapterId,
        promptSha256: sha256Hex(utf8(job.request.prompt)),
        resourceRefs: job.request.resourceRefs,
        outputText: result.outputText,
        outputSha256: sha256Hex(utf8(result.outputText)),
        citations: result.citations,
        providerResult: result,
        completedAt
      };
      evidenceHash = await this.#evidence.put(evidence);
      completedSuccessfully = true;
    } catch (error) {
      errorMessage = safeError(error);
    }
    const completedAt = this.#clock().toISOString();
    await this.#state.put({
      jobId: job.jobId,
      lastAttemptAt: completedAt,
      lastCompletedAt: completedSuccessfully ? completedAt : previous?.lastCompletedAt ?? null,
      lastStatus: completedSuccessfully ? "SUCCEEDED" : "FAILED",
      lastRunId: runId,
      lastEvidenceHash: evidenceHash ?? previous?.lastEvidenceHash ?? null
    });
    return {
      runId,
      jobId: job.jobId,
      adapterId: job.adapterId,
      status: completedSuccessfully ? "SUCCEEDED" : "FAILED",
      startedAt,
      completedAt,
      providerReceiptId,
      evidenceHash,
      error: errorMessage
    };
  }
}

export class FileRetrievalStateStore implements RetrievalStateStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = validateStorageRoot(root, "retrieval evidence");
  }

  async get(jobId: string): Promise<RetrievalJobState | null> {
    if (!/^[A-Za-z0-9._-]{3,128}$/.test(jobId)) throw new Error("retrieval jobId contains unsupported characters");
    const value = await readJsonFile(withinStorageRoot(this.#root, "retrieval-state", `${jobId}.json`));
    if (value === null) return null;
    if (typeof value !== "object" || Array.isArray(value)) throw new Error("invalid retrieval job state");
    const state = value as Partial<RetrievalJobState>;
    if (state.jobId !== jobId
      || typeof state.lastAttemptAt !== "string"
      || !Number.isFinite(new Date(state.lastAttemptAt).valueOf())
      || (state.lastCompletedAt !== null && (typeof state.lastCompletedAt !== "string" || !Number.isFinite(new Date(state.lastCompletedAt).valueOf())))
      || (state.lastStatus !== "SUCCEEDED" && state.lastStatus !== "FAILED")
      || typeof state.lastRunId !== "string"
      || (state.lastEvidenceHash !== null && (typeof state.lastEvidenceHash !== "string" || !/^[a-f0-9]{64}$/.test(state.lastEvidenceHash)))) {
      throw new Error("invalid retrieval job state");
    }
    return state as RetrievalJobState;
  }

  async put(state: RetrievalJobState): Promise<void> {
    if (!/^[A-Za-z0-9._-]{3,128}$/.test(state.jobId)) throw new Error("retrieval jobId contains unsupported characters");
    await durableAtomicJson(withinStorageRoot(this.#root, "retrieval-state", `${state.jobId}.json`), state);
  }
}

export class FileInferenceEvidenceStore implements InferenceEvidenceStore {
  readonly #root: string;
  readonly #maximumBytes: number;

  constructor(root: string, maximumBytes = 8 * 1024 * 1024) {
    this.#root = validateStorageRoot(root, "retrieval evidence");
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 64 * 1024 * 1024) {
      throw new Error("inference evidence maximumBytes must be from 1 through 67108864");
    }
    this.#maximumBytes = maximumBytes;
  }

  async put(evidence: AutonomousInferenceEvidence): Promise<string> {
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    const bytes = utf8(serialized);
    if (bytes.byteLength > this.#maximumBytes) throw new Error("autonomous inference evidence exceeds the configured byte limit");
    const hash = sha256Hex(bytes);
    await durableAtomicJson(withinStorageRoot(this.#root, "inference-evidence", evidence.jobId, `${evidence.runId}.json`), evidence);
    return hash;
  }
}

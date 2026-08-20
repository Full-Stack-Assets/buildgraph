import { randomUUID } from "node:crypto";
import type { AdapterId, DataAdapter, ReadResult } from "./core.js";
import { sha256Hex, utf8 } from "./core.js";
import { AdapterHttpError } from "./http.js";
import { safeStoredMessage } from "./file-store.js";
import type { CanonSink, CheckpointStore, DeadLetterStore, IngestReceipt } from "./storage.js";
import { deadLetter, storageReceiptSummary } from "./storage.js";

export type SyncRunReceipt = {
  runId: string;
  adapterId: AdapterId;
  status: "SUCCEEDED" | "DEGRADED" | "FAILED" | "CANCELLED";
  startedAt: string;
  completedAt: string;
  startingCursorHash: string | null;
  endingCursorHash: string | null;
  pages: number;
  listed: number;
  ingested: number;
  failed: number;
  ingestSummary: ReturnType<typeof storageReceiptSummary>;
  error: string | null;
};

export type ContinuousSyncConfig = {
  intervalMs: number;
  maximumPagesPerRun?: number;
  stopPageOnItemFailure?: boolean;
  clock?: () => Date;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
};

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error("sync cancelled"));
      return;
    }
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason ?? new Error("sync cancelled"));
      },
      { once: true }
    );
  });
}

function isRetryable(error: unknown): boolean {
  if (error instanceof AdapterHttpError) return error.retryable;
  return !(error instanceof Error && (
    error.message.includes("outside the adapter namespace")
    || error.message.includes("invalid")
    || error.message.includes("non-progressing pagination cursor")
  ));
}

export class ContinuousSyncEngine {
  readonly #adapters: Map<AdapterId, DataAdapter>;
  readonly #sink: CanonSink;
  readonly #checkpoints: CheckpointStore;
  readonly #deadLetters: DeadLetterStore;
  readonly #config: Required<Omit<ContinuousSyncConfig, "clock" | "sleep">> & Pick<ContinuousSyncConfig, "clock" | "sleep">;

  constructor(input: {
    adapters: DataAdapter[];
    sink: CanonSink;
    checkpoints: CheckpointStore;
    deadLetters: DeadLetterStore;
    config: ContinuousSyncConfig;
  }) {
    if (!Number.isFinite(input.config.intervalMs) || input.config.intervalMs < 1_000) {
      throw new Error("continuous sync interval must be at least 1000ms");
    }
    const maximumPagesPerRun = input.config.maximumPagesPerRun ?? 100;
    if (!Number.isSafeInteger(maximumPagesPerRun) || maximumPagesPerRun < 1 || maximumPagesPerRun > 10_000) {
      throw new Error("maximumPagesPerRun must be an integer from 1 through 10000");
    }
    this.#adapters = new Map(input.adapters.map((adapter) => [adapter.capabilities.adapterId, adapter]));
    if (this.#adapters.size !== input.adapters.length) throw new Error("continuous sync adapter IDs must be unique");
    this.#sink = input.sink;
    this.#checkpoints = input.checkpoints;
    this.#deadLetters = input.deadLetters;
    this.#config = {
      intervalMs: input.config.intervalMs,
      maximumPagesPerRun,
      stopPageOnItemFailure: input.config.stopPageOnItemFailure ?? true,
      clock: input.config.clock,
      sleep: input.config.sleep
    };
  }

  async syncAdapter(adapterId: AdapterId, signal?: AbortSignal): Promise<SyncRunReceipt> {
    const adapter = this.#adapters.get(adapterId);
    if (!adapter) throw new Error(`adapter ${adapterId} is not registered`);
    const clock = this.#config.clock ?? (() => new Date());
    const runId = `sync-${adapterId}-${randomUUID()}`;
    const startedAt = clock().toISOString();
    let cursor = (await this.#checkpoints.get(adapterId))?.cursor ?? null;
    const startingCursorHash = cursor ? sha256Hex(utf8(cursor)) : null;
    let pages = 0;
    let listed = 0;
    let failed = 0;
    let pageLimitReachedWithMore = false;
    const receipts: IngestReceipt[] = [];
    let runError: string | null = null;

    try {
      while (pages < this.#config.maximumPagesPerRun) {
        if (signal?.aborted) throw signal.reason ?? new Error("sync cancelled");
        const pageCursor = cursor;
        let page;
        try {
          page = await adapter.listChanges(pageCursor);
        } catch (error) {
          failed += 1;
          await this.#deadLetters.put(deadLetter({
            runId,
            adapterId,
            externalIdHash: null,
            phase: "list",
            occurredAt: clock().toISOString(),
            retryable: isRetryable(error),
            error
          }));
          throw error;
        }
        try {
          if (page.adapterId !== adapterId || !Number.isFinite(new Date(page.observedAt).valueOf())) {
            throw new Error("adapter returned an invalid change page identity or timestamp");
          }
          if (!Array.isArray(page.items) || typeof page.hasMore !== "boolean"
            || (page.nextCursor !== null && typeof page.nextCursor !== "string")) {
            throw new Error("adapter returned an invalid change page structure");
          }
          for (const item of page.items) {
            if (item.adapterId !== adapterId) throw new Error("adapter returned an item outside its namespace");
            if (!item.externalId || item.externalId.length > 4_096 || item.externalId.includes("\0")
              || !item.name || !item.mimeType
              || (item.sizeBytes !== null && (!Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 0))
              || (item.createdAt !== null && !Number.isFinite(new Date(item.createdAt).valueOf()))
              || (item.modifiedAt !== null && !Number.isFinite(new Date(item.modifiedAt).valueOf()))) {
              throw new Error("adapter returned an invalid change item");
            }
          }
        } catch (error) {
          failed += 1;
          await this.#deadLetters.put(deadLetter({
            runId,
            adapterId,
            externalIdHash: null,
            phase: "list",
            occurredAt: clock().toISOString(),
            retryable: false,
            error
          }));
          throw error;
        }
        pages += 1;
        listed += page.items.length;
        let pageFailed = false;
        for (const item of page.items) {
          let result: ReadResult;
          try {
            result = item.deleted
              ? { item, bytes: null, contentHash: item.contentHash, unavailableReason: "Source item was deleted." }
              : await adapter.read(item);
          } catch (error) {
            failed += 1;
            pageFailed = true;
            await this.#deadLetters.put(deadLetter({
              runId,
              adapterId,
              externalIdHash: sha256Hex(utf8(`${adapterId}\0${item.externalId}`)),
              phase: "read",
              occurredAt: clock().toISOString(),
              retryable: isRetryable(error),
              error
            }));
            if (this.#config.stopPageOnItemFailure) break;
            continue;
          }
          try {
            receipts.push(await this.#sink.ingest(runId, item, result, page.observedAt));
          } catch (error) {
            failed += 1;
            pageFailed = true;
            await this.#deadLetters.put(deadLetter({
              runId,
              adapterId,
              externalIdHash: sha256Hex(utf8(`${adapterId}\0${item.externalId}`)),
              phase: "ingest",
              occurredAt: clock().toISOString(),
              retryable: isRetryable(error),
              error
            }));
            if (this.#config.stopPageOnItemFailure) break;
          }
        }
        if (pageFailed) {
          throw new Error("sync page contained an item failure; cursor was not advanced");
        }
        if (page.hasMore && (!page.nextCursor || page.nextCursor === pageCursor)) {
          throw new Error("adapter returned a non-progressing pagination cursor");
        }
        cursor = page.nextCursor;
        try {
          await this.#checkpoints.put({ adapterId, cursor, updatedAt: clock().toISOString(), lastRunId: runId });
        } catch (error) {
          failed += 1;
          await this.#deadLetters.put(deadLetter({
            runId,
            adapterId,
            externalIdHash: null,
            phase: "checkpoint",
            occurredAt: clock().toISOString(),
            retryable: true,
            error
          }));
          throw error;
        }
        if (!page.hasMore) break;
        if (pages >= this.#config.maximumPagesPerRun) pageLimitReachedWithMore = true;
      }
      if (pageLimitReachedWithMore) throw new Error("sync exceeded maximumPagesPerRun");
    } catch (error) {
      runError = safeStoredMessage(error);
    }
    const cancelled = signal?.aborted === true;
    return {
      runId,
      adapterId,
      status: cancelled ? "CANCELLED" : runError ? (receipts.length > 0 ? "DEGRADED" : "FAILED") : failed > 0 ? "DEGRADED" : "SUCCEEDED",
      startedAt,
      completedAt: clock().toISOString(),
      startingCursorHash,
      endingCursorHash: cursor ? sha256Hex(utf8(cursor)) : null,
      pages,
      listed,
      ingested: receipts.length,
      failed,
      ingestSummary: storageReceiptSummary(receipts),
      error: runError
    };
  }

  async syncOnce(signal?: AbortSignal): Promise<SyncRunReceipt[]> {
    const results: SyncRunReceipt[] = [];
    for (const adapterId of this.#adapters.keys()) {
      if (signal?.aborted) break;
      results.push(await this.syncAdapter(adapterId, signal));
    }
    return results;
  }

  async run(signal: AbortSignal, onCycle?: (receipts: SyncRunReceipt[]) => Promise<void> | void): Promise<void> {
    const sleep = this.#config.sleep ?? defaultSleep;
    while (!signal.aborted) {
      const receipts = await this.syncOnce(signal);
      await onCycle?.(receipts);
      if (!signal.aborted) {
        try {
          await sleep(this.#config.intervalMs, signal);
        } catch (error) {
          if (!signal.aborted) throw error;
        }
      }
    }
  }
}

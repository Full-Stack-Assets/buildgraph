import { describe, expect, it, vi } from "vitest";
import type { ChangePage, DataAdapter, DataItem, ReadResult } from "../adapters/data/core.js";
import { AdapterHttpError } from "../adapters/data/http.js";
import { ContinuousSyncEngine } from "../adapters/data/sync-engine.js";
import type { CanonSink, CheckpointStore, DeadLetter, DeadLetterStore, IngestReceipt, SyncCheckpoint } from "../adapters/data/storage.js";

const item: DataItem = {
  adapterId: "grok",
  externalId: "file_1",
  version: "v1",
  name: "one.txt",
  mimeType: "text/plain",
  sizeBytes: 3,
  createdAt: "2026-08-20T12:00:00.000Z",
  modifiedAt: "2026-08-20T12:00:00.000Z",
  contentHash: null,
  contentAvailability: "downloadable",
  deleted: false,
  sourceUri: "xai://files/file_1",
  metadata: {}
};

function adapter(page: ChangePage): DataAdapter {
  return {
    capabilities: {
      adapterId: "grok",
      evidenceState: "TESTED",
      operations: ["list", "read"],
      supportsIncrementalCursor: true,
      supportsContentDownload: true,
      supportsContinuousSync: true,
      maximumItemBytes: 1024,
      constraints: []
    },
    healthCheck: async () => ({
      adapterId: "grok", status: "HEALTHY", checkedAt: page.observedAt, latencyMs: 0,
      authenticated: true, readVerified: true, writeConfigured: false, detail: "test", evidence: {}
    }),
    listChanges: vi.fn(async () => page),
    read: vi.fn(async (): Promise<ReadResult> => ({ item, bytes: new TextEncoder().encode("one"), contentHash: null, unavailableReason: null })),
    write: async () => { throw new Error("not enabled"); }
  };
}

class MemoryCheckpointStore implements CheckpointStore {
  value: SyncCheckpoint | null = null;
  async get(): Promise<SyncCheckpoint | null> { return this.value; }
  async put(value: SyncCheckpoint): Promise<void> { this.value = value; }
}

class MemoryDeadLetters implements DeadLetterStore {
  readonly values: DeadLetter[] = [];
  async put(value: DeadLetter): Promise<void> { this.values.push(value); }
}

const receipt: IngestReceipt = {
  receiptId: "ingest-1", runId: "run", adapterId: "grok", externalIdHash: "hash", contentHash: "content",
  recordPath: "record", objectPath: "object", status: "CREATED", observedAt: "2026-08-20T12:00:00.000Z"
};

describe("ContinuousSyncEngine", () => {
  it("does not advance a page cursor after an ingest failure", async () => {
    const checkpoints = new MemoryCheckpointStore();
    checkpoints.value = { adapterId: "grok", cursor: "cursor-before", updatedAt: "2026-08-20T11:00:00.000Z", lastRunId: "previous" };
    const deadLetters = new MemoryDeadLetters();
    const sink: CanonSink = { ingest: async () => { throw new Error("sink unavailable"); } };
    const engine = new ContinuousSyncEngine({
      adapters: [adapter({ adapterId: "grok", observedAt: "2026-08-20T12:00:00.000Z", items: [item], nextCursor: "cursor-after", hasMore: false })],
      sink,
      checkpoints,
      deadLetters,
      config: { intervalMs: 1000 }
    });

    const result = await engine.syncAdapter("grok");
    expect(result.status).toBe("FAILED");
    expect(checkpoints.value?.cursor).toBe("cursor-before");
    expect(deadLetters.values).toMatchObject([{ phase: "ingest", adapterId: "grok" }]);
  });

  it("allows a complete final page at the configured page limit", async () => {
    const checkpoints = new MemoryCheckpointStore();
    const deadLetters = new MemoryDeadLetters();
    const sink: CanonSink = { ingest: async () => receipt };
    const engine = new ContinuousSyncEngine({
      adapters: [adapter({ adapterId: "grok", observedAt: "2026-08-20T12:00:00.000Z", items: [item], nextCursor: "cursor-final", hasMore: false })],
      sink,
      checkpoints,
      deadLetters,
      config: { intervalMs: 1000, maximumPagesPerRun: 1 }
    });

    const result = await engine.syncAdapter("grok");
    expect(result).toMatchObject({ status: "SUCCEEDED", pages: 1, ingested: 1 });
    expect(checkpoints.value?.cursor).toBe("cursor-final");
  });

  it("ingests provider tombstones without trying to re-read a deleted object", async () => {
    const checkpoints = new MemoryCheckpointStore();
    const deadLetters = new MemoryDeadLetters();
    const source = adapter({
      adapterId: "grok",
      observedAt: "2026-08-20T12:00:00.000Z",
      items: [{ ...item, deleted: true }],
      nextCursor: "cursor-deleted",
      hasMore: false
    });
    const ingest = vi.fn(async () => receipt);
    const engine = new ContinuousSyncEngine({
      adapters: [source],
      sink: { ingest },
      checkpoints,
      deadLetters,
      config: { intervalMs: 1000 }
    });

    await expect(engine.syncAdapter("grok")).resolves.toMatchObject({ status: "SUCCEEDED" });
    expect(source.read).not.toHaveBeenCalled();
    expect(ingest).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ deleted: true }), expect.objectContaining({ bytes: null }), expect.any(String));
  });

  it("preserves provider retryability in dead letters", async () => {
    const checkpoints = new MemoryCheckpointStore();
    const deadLetters = new MemoryDeadLetters();
    const source = adapter({ adapterId: "grok", observedAt: "2026-08-20T12:00:00.000Z", items: [], nextCursor: null, hasMore: false });
    source.listChanges = async () => {
      throw new AdapterHttpError({ message: "denied", status: 403, retryable: false });
    };
    const engine = new ContinuousSyncEngine({
      adapters: [source],
      sink: { ingest: async () => receipt },
      checkpoints,
      deadLetters,
      config: { intervalMs: 1000 }
    });

    await expect(engine.syncAdapter("grok")).resolves.toMatchObject({ status: "FAILED" });
    expect(deadLetters.values).toMatchObject([{ phase: "list", retryable: false }]);
  });

  it("dead-letters an invalid provider page without advancing its cursor", async () => {
    const checkpoints = new MemoryCheckpointStore();
    checkpoints.value = { adapterId: "grok", cursor: "cursor-before", updatedAt: "2026-08-20T11:00:00.000Z", lastRunId: "previous" };
    const deadLetters = new MemoryDeadLetters();
    const source = adapter({
      adapterId: "grok",
      observedAt: "not-a-date",
      items: [],
      nextCursor: "cursor-after",
      hasMore: false
    });
    const engine = new ContinuousSyncEngine({
      adapters: [source],
      sink: { ingest: async () => receipt },
      checkpoints,
      deadLetters,
      config: { intervalMs: 1000 }
    });

    await expect(engine.syncAdapter("grok")).resolves.toMatchObject({ status: "FAILED", failed: 1 });
    expect(checkpoints.value.cursor).toBe("cursor-before");
    expect(deadLetters.values).toMatchObject([{ phase: "list", retryable: false }]);
  });

  it("treats an abort during the daemon wait as a graceful shutdown", async () => {
    const controller = new AbortController();
    const engine = new ContinuousSyncEngine({
      adapters: [adapter({ adapterId: "grok", observedAt: "2026-08-20T12:00:00.000Z", items: [], nextCursor: null, hasMore: false })],
      sink: { ingest: async () => receipt },
      checkpoints: new MemoryCheckpointStore(),
      deadLetters: new MemoryDeadLetters(),
      config: {
        intervalMs: 1000,
        sleep: async () => {
          controller.abort(new Error("SIGTERM"));
          throw controller.signal.reason;
        }
      }
    });

    await expect(engine.run(controller.signal)).resolves.toBeUndefined();
  });
});

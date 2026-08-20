import { randomUUID } from "node:crypto";
import type { AdapterId, DataItem, JsonObject, ReadResult } from "./core.js";
import { sha256Hex, utf8 } from "./core.js";
import {
  durableAtomicJson,
  durableWriteContentAddressed,
  readJsonFile,
  safeStoredMessage,
  validateStorageRoot,
  withinStorageRoot
} from "./file-store.js";

export type SyncCheckpoint = {
  adapterId: AdapterId;
  cursor: string | null;
  updatedAt: string;
  lastRunId: string;
};

export interface CheckpointStore {
  get(adapterId: AdapterId): Promise<SyncCheckpoint | null>;
  put(checkpoint: SyncCheckpoint): Promise<void>;
}

export type IngestReceipt = {
  receiptId: string;
  runId: string;
  adapterId: AdapterId;
  externalIdHash: string;
  contentHash: string | null;
  recordPath: string;
  objectPath: string | null;
  status: "CREATED" | "UPDATED" | "UNCHANGED" | "TOMBSTONED";
  observedAt: string;
};

export interface CanonSink {
  ingest(runId: string, item: DataItem, result: ReadResult, observedAt: string): Promise<IngestReceipt>;
}

export type DeadLetter = {
  runId: string;
  adapterId: AdapterId;
  externalIdHash: string | null;
  phase: "list" | "read" | "ingest" | "checkpoint";
  occurredAt: string;
  errorClass: string;
  message: string;
  retryable: boolean;
};

export interface DeadLetterStore {
  put(letter: DeadLetter): Promise<void>;
}

export class FileCheckpointStore implements CheckpointStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = validateStorageRoot(root, "Canon sync storage");
  }

  #path(adapterId: AdapterId): string {
    return withinStorageRoot(this.#root, "checkpoints", `${adapterId}.json`);
  }

  async get(adapterId: AdapterId): Promise<SyncCheckpoint | null> {
    const value = await readJsonFile(this.#path(adapterId));
    if (value === null) return null;
    if (typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid checkpoint for ${adapterId}`);
    const checkpoint = value as Partial<SyncCheckpoint>;
    if (checkpoint.adapterId !== adapterId || typeof checkpoint.updatedAt !== "string" || typeof checkpoint.lastRunId !== "string") {
      throw new Error(`invalid checkpoint for ${adapterId}`);
    }
    if (checkpoint.cursor !== null && typeof checkpoint.cursor !== "string") throw new Error(`invalid cursor in checkpoint for ${adapterId}`);
    return checkpoint as SyncCheckpoint;
  }

  async put(checkpoint: SyncCheckpoint): Promise<void> {
    await durableAtomicJson(this.#path(checkpoint.adapterId), checkpoint);
  }
}

type StoredRecord = {
  schemaVersion: "aoc.canon.ingested-document/v1";
  source: DataItem;
  content: {
    hashSha256: string | null;
    objectPath: string | null;
    unavailableReason: string | null;
  };
  provenance: {
    firstObservedAt: string;
    lastObservedAt: string;
    lastRunId: string;
  };
};

function storedRecord(value: unknown, item: DataItem): StoredRecord | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("stored Canon record is invalid");
  const record = value as Partial<StoredRecord>;
  if (record.schemaVersion !== "aoc.canon.ingested-document/v1"
    || record.source?.adapterId !== item.adapterId
    || record.source.externalId !== item.externalId
    || typeof record.content !== "object"
    || typeof record.provenance?.firstObservedAt !== "string"
    || typeof record.provenance.lastObservedAt !== "string"
    || typeof record.provenance.lastRunId !== "string") {
    throw new Error("stored Canon record is invalid");
  }
  return record as StoredRecord;
}

export class FileSystemCanonSink implements CanonSink {
  readonly #root: string;
  readonly #maximumItemBytes: number;

  constructor(root: string, maximumItemBytes = 64 * 1024 * 1024) {
    this.#root = validateStorageRoot(root, "Canon sync storage");
    if (!Number.isSafeInteger(maximumItemBytes) || maximumItemBytes < 1 || maximumItemBytes > 64 * 1024 * 1024) {
      throw new Error("Canon sink maximumItemBytes must be from 1 through 67108864");
    }
    this.#maximumItemBytes = maximumItemBytes;
  }

  async ingest(runId: string, item: DataItem, result: ReadResult, observedAt: string): Promise<IngestReceipt> {
    if (result.item.adapterId !== item.adapterId || result.item.externalId !== item.externalId) {
      throw new Error("read result identity does not match the listed source item");
    }
    if (result.bytes && result.bytes.byteLength > this.#maximumItemBytes) throw new Error("ingested item exceeds Canon sink maximumItemBytes");
    const externalIdHash = sha256Hex(utf8(`${item.adapterId}\0${item.externalId}`));
    const recordPath = withinStorageRoot(this.#root, "records", item.adapterId, `${externalIdHash}.json`);
    const existing = storedRecord(await readJsonFile(recordPath), item);
    const computedContentHash = result.bytes ? sha256Hex(result.bytes) : null;
    if (computedContentHash && result.contentHash && computedContentHash !== result.contentHash) {
      throw new Error("read result content hash does not match its bytes");
    }
    const contentHash = computedContentHash ?? result.contentHash;
    const objectPath = result.bytes && contentHash
      ? withinStorageRoot(this.#root, "objects", contentHash.slice(0, 2), contentHash)
      : null;

    if (objectPath) {
      await durableWriteContentAddressed(objectPath, result.bytes as Uint8Array);
    }
    if (objectPath) {
      const metadataPath = `${objectPath}.meta.json`;
      const metadata = await readJsonFile(metadataPath);
      if (metadata === null) await durableAtomicJson(metadataPath, {
        sha256: contentHash,
        byteLength: result.bytes?.byteLength ?? 0,
        firstSource: { adapterId: item.adapterId, externalIdHash },
        createdAt: observedAt
      });
      else if (typeof metadata !== "object" || Array.isArray(metadata)
        || (metadata as { sha256?: unknown }).sha256 !== contentHash
        || (metadata as { byteLength?: unknown }).byteLength !== result.bytes?.byteLength) {
        throw new Error("content-addressed object metadata is invalid");
      }
    }

    const same = existing?.source.version === item.version
      && existing?.content.hashSha256 === contentHash
      && existing?.source.deleted === item.deleted;
    const status: IngestReceipt["status"] = item.deleted
      ? "TOMBSTONED"
      : same
        ? "UNCHANGED"
        : existing
          ? "UPDATED"
          : "CREATED";
    const record: StoredRecord = {
      schemaVersion: "aoc.canon.ingested-document/v1",
      source: { ...item, contentHash },
      content: {
        hashSha256: contentHash,
        objectPath: objectPath ? objectPath.slice(this.#root.length + 1) : null,
        unavailableReason: result.unavailableReason
      },
      provenance: {
        firstObservedAt: existing?.provenance.firstObservedAt ?? observedAt,
        lastObservedAt: observedAt,
        lastRunId: runId
      }
    };
    await durableAtomicJson(recordPath, record);
    const receipt: IngestReceipt = {
      receiptId: `ingest-${randomUUID()}`,
      runId,
      adapterId: item.adapterId,
      externalIdHash,
      contentHash,
      recordPath: recordPath.slice(this.#root.length + 1),
      objectPath: objectPath ? objectPath.slice(this.#root.length + 1) : null,
      status,
      observedAt
    };
    await durableAtomicJson(withinStorageRoot(this.#root, "receipts", item.adapterId, `${receipt.receiptId}.json`), receipt);
    return receipt;
  }
}

export class FileDeadLetterStore implements DeadLetterStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = validateStorageRoot(root, "Canon sync storage");
  }

  async put(letter: DeadLetter): Promise<void> {
    await durableAtomicJson(withinStorageRoot(this.#root, "dead-letters", letter.adapterId, `${letter.runId}-${randomUUID()}.json`), letter);
  }
}

export function deadLetter(input: Omit<DeadLetter, "message" | "errorClass"> & { error: unknown }): DeadLetter {
  return {
    ...input,
    errorClass: input.error instanceof Error ? input.error.name : "UnknownError",
    message: safeStoredMessage(input.error)
  };
}

export function storageReceiptSummary(receipts: IngestReceipt[]): JsonObject {
  const counts: Record<IngestReceipt["status"], number> = { CREATED: 0, UPDATED: 0, UNCHANGED: 0, TOMBSTONED: 0 };
  for (const receipt of receipts) counts[receipt.status] += 1;
  return counts;
}

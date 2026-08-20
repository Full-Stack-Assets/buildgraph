import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DataItem } from "../adapters/data/core.js";
import { encodeCursor } from "../adapters/data/cursor.js";
import { FileCheckpointStore, FileSystemCanonSink } from "../adapters/data/storage.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "canon-storage-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

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

describe("Canon storage contracts", () => {
  it("fails closed on a corrupt checkpoint instead of silently resetting the cursor", async () => {
    const root = await temporaryRoot();
    const path = resolve(root, "checkpoints", "grok.json");
    await mkdir(resolve(root, "checkpoints"));
    await writeFile(path, "[]\n", "utf8");
    await expect(new FileCheckpointStore(root).get("grok")).rejects.toThrow("invalid checkpoint");
  });

  it("rejects bytes that disagree with a provider read hash", async () => {
    const root = await temporaryRoot();
    const sink = new FileSystemCanonSink(root);
    await expect(sink.ingest("run-1", item, {
      item,
      bytes: new TextEncoder().encode("one"),
      contentHash: "a".repeat(64),
      unavailableReason: null
    }, "2026-08-20T12:00:00.000Z")).rejects.toThrow("content hash");
  });

  it("rejects cursors that cannot be read back within the contract limit", () => {
    expect(() => encodeCursor({ token: "x".repeat(20_000) })).toThrow("maximum encoded length");
  });
});

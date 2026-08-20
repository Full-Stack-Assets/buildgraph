import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendDurableJsonLine,
  durableAtomicJson,
  durableWriteContentAddressed,
  FileProcessLease,
  readJsonFile,
  safeStoredMessage
} from "../adapters/data/file-store.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "canon-file-store-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("durable Canon file storage", () => {
  it("atomically persists JSON and append-only receipts", async () => {
    const root = await temporaryRoot();
    const state = resolve(root, "state", "one.json");
    const log = resolve(root, "receipts", "runs.jsonl");
    await durableAtomicJson(state, { status: "ok" });
    await appendDurableJsonLine(log, { run: 1 });
    await appendDurableJsonLine(log, { run: 2 });
    await expect(readJsonFile(state)).resolves.toEqual({ status: "ok" });
    expect((await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as unknown)).toEqual([{ run: 1 }, { run: 2 }]);
  });

  it("allows only one active process lease and permits reacquisition after release", async () => {
    const root = await temporaryRoot();
    const lease = await FileProcessLease.acquire(root, "sync-test", 30_000);
    await expect(FileProcessLease.acquire(root, "sync-test", 30_000)).rejects.toThrow("active lease");
    await lease.release();
    const replacement = await FileProcessLease.acquire(root, "sync-test", 30_000);
    await replacement.release();
  });

  it("deduplicates racing content-addressed writes and redacts credential-shaped errors", async () => {
    const root = await temporaryRoot();
    const path = resolve(root, "objects", "aa", "digest");
    const bytes = new TextEncoder().encode("same-content");
    await Promise.all([durableWriteContentAddressed(path, bytes), durableWriteContentAddressed(path, bytes)]);
    expect(await readFile(path, "utf8")).toBe("same-content");
    await expect(durableWriteContentAddressed(path, new TextEncoder().encode("other-bytes"))).rejects.toThrow("different bytes");
    expect(safeStoredMessage(new Error("Bearer abc.def token=supersecretvalue"))).toBe("Bearer [redacted] token=[redacted]");
  });
});

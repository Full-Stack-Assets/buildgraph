import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  JsonFileIdempotencyStore,
  MemoryIdempotencyStore
} from "../adapters/clickup/idempotency.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ClickUp idempotency stores", () => {
  it("fails closed when the same key is already pending", async () => {
    const store = new MemoryIdempotencyStore();
    await store.begin("task_123:create");

    await expect(store.begin("task_123:create")).rejects.toThrow("idempotency key already exists");
    expect(await store.get("task_123:create")).toMatchObject({ state: "pending" });
  });

  it("persists completed normalized results across JSON store instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "buildgraph-clickup-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "idempotency.json");

    const store = new JsonFileIdempotencyStore(path, () => "2026-08-18T02:30:00.000Z");
    await store.begin("task_456:create");
    await store.complete("task_456:create", { taskId: "clickup-456", status: "created" });

    const reloaded = new JsonFileIdempotencyStore(path, () => "2026-08-18T02:31:00.000Z");
    expect(await reloaded.get("task_456:create")).toEqual({
      state: "completed",
      completedAt: "2026-08-18T02:30:00.000Z",
      result: { taskId: "clickup-456", status: "created" }
    });
  });

  it("releases a failed pending key so an explicit retry can begin", async () => {
    const store = new MemoryIdempotencyStore();
    await store.begin("task_789:update");
    await store.release("task_789:update");

    expect(await store.get("task_789:update")).toBeUndefined();
    await expect(store.begin("task_789:update")).resolves.toBeUndefined();
  });
});

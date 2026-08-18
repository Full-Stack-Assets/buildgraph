import { describe, expect, it } from "vitest";
import { BoundedAsyncQueue } from "../adapters/clickup/queue.js";

describe("BoundedAsyncQueue", () => {
  it("rejects overflow instead of silently dropping work", async () => {
    const queue = new BoundedAsyncQueue({ concurrency: 1, maxPending: 1 });
    let release: () => void = () => undefined;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = queue.enqueue(async () => {
      await blocker;
      return "first";
    });
    const second = queue.enqueue(async () => "second");

    await expect(queue.enqueue(async () => "overflow")).rejects.toThrow("queue capacity exceeded");
    expect(queue.active).toBe(1);
    expect(queue.pending).toBe(1);

    release();
    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
  });

  it("never executes more work than the configured concurrency", async () => {
    const queue = new BoundedAsyncQueue({ concurrency: 2, maxPending: 4 });
    let active = 0;
    let maxObserved = 0;

    const work = Array.from({ length: 6 }, (_, index) => queue.enqueue(async () => {
      active += 1;
      maxObserved = Math.max(maxObserved, active);
      await Promise.resolve();
      active -= 1;
      return index;
    }));

    await expect(Promise.all(work)).resolves.toEqual([0, 1, 2, 3, 4, 5]);
    expect(maxObserved).toBe(2);
    expect(queue.active).toBe(0);
    expect(queue.pending).toBe(0);
  });
});

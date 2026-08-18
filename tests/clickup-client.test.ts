import { describe, expect, it, vi } from "vitest";
import { ClickUpClient } from "../adapters/clickup/client.js";

describe("ClickUpClient", () => {
  it("sends authorization and JSON while capturing rate-limit headers", async () => {
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: "pk_test",
        "Content-Type": "application/json"
      });
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify({ name: "Mission task" }));

      return new Response(JSON.stringify({ id: "task-1" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-ratelimit-limit": "100",
          "x-ratelimit-remaining": "99",
          "x-ratelimit-reset": "1893456000"
        }
      });
    });

    const client = new ClickUpClient({ token: "pk_test", fetchFn });
    const result = await client.request<{ id: string }>("POST", "/list/123/task", { name: "Mission task" });

    expect(result).toEqual({ id: "task-1" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(client.rateLimitSnapshot).toEqual({
      limit: 100,
      remaining: 99,
      resetAtMs: 1_893_456_000_000
    });
  });

  it("retries a 429 at the server reset time", async () => {
    const responses = [
      new Response("rate limited", {
        status: 429,
        headers: { "x-ratelimit-reset": "1001" }
      }),
      new Response(JSON.stringify({ id: "task-1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ];
    const sleep = vi.fn(async (ms: number) => {
      expect(ms).toBeGreaterThanOrEqual(0);
    });
    const fetchFn = vi.fn(async () => responses.shift()!);
    const client = new ClickUpClient({
      token: "pk_test",
      fetchFn,
      now: () => 1_000_000,
      sleep,
      maxRetries: 2
    });

    await client.request("GET", "/task/task-1");

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("does not retry a non-retryable authorization failure", async () => {
    const fetchFn = vi.fn(async () => new Response("forbidden", { status: 403 }));
    const client = new ClickUpClient({ token: "pk_test", fetchFn, maxRetries: 4 });

    await expect(client.request("GET", "/task/task-1")).rejects.toMatchObject({
      status: 403
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("does not replay an ambiguous POST after a 5xx response", async () => {
    const responses = [
      new Response("server failed after mutation may have committed", { status: 500 }),
      new Response(JSON.stringify({ id: "duplicate-task" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ];
    const sleep = vi.fn(async () => undefined);
    const fetchFn = vi.fn(async () => responses.shift()!);
    const client = new ClickUpClient({ token: "pk_test", fetchFn, sleep, maxRetries: 3 });

    await expect(client.request("POST", "/list/123/task", { name: "Do not duplicate" })).rejects.toMatchObject({
      status: 500
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("still retries a transient 5xx for a read", async () => {
    const responses = [
      new Response("temporary upstream failure", { status: 503 }),
      new Response(JSON.stringify({ id: "task-1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ];
    const sleep = vi.fn(async () => undefined);
    const fetchFn = vi.fn(async () => responses.shift()!);
    const client = new ClickUpClient({ token: "pk_test", fetchFn, sleep, maxRetries: 2, backoffBaseMs: 250 });

    await expect(client.request("GET", "/task/task-1")).resolves.toEqual({ id: "task-1" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });
});

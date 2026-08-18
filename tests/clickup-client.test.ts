import { describe, expect, it, vi } from "vitest";
import { ClickUpClient, ClickUpHttpError } from "../adapters/clickup/client.js";

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
    const sleep = vi.fn(async (_ms: number) => undefined);
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

    await expect(client.request("GET", "/task/task-1")).rejects.toMatchObject<Partial<ClickUpHttpError>>({
      status: 403
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

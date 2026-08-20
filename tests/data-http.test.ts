import { describe, expect, it, vi } from "vitest";
import { adapterRequest } from "../adapters/data/http.js";

describe("adapter HTTP boundary", () => {
  it("rejects non-HTTPS and non-allowlisted destinations before transport", async () => {
    const fetcher = vi.fn(async () => new Response("ok"));
    await expect(adapterRequest({
      url: "http://api.example.com/data",
      allowedHosts: ["api.example.com"],
      maximumResponseBytes: 1024,
      fetcher
    })).rejects.toThrow("require HTTPS");
    await expect(adapterRequest({
      url: "https://evil.example/data",
      allowedHosts: ["api.example.com"],
      maximumResponseBytes: 1024,
      fetcher
    })).rejects.toThrow("outside the configured allowlist");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("retries a transient network failure for a read", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(new Response("ok"));
    const sleep = vi.fn(async () => undefined);
    await expect(adapterRequest({
      url: "https://api.example.com/data",
      allowedHosts: ["api.example.com"],
      maximumResponseBytes: 1024,
      fetcher,
      sleep
    })).resolves.toMatchObject({ bytes: expect.any(Uint8Array) });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not replay a mutation after an ambiguous network failure by default", async () => {
    const fetcher = vi.fn(async () => { throw new TypeError("connection reset"); });
    await expect(adapterRequest({
      url: "https://api.example.com/data",
      init: { method: "POST", body: "payload" },
      allowedHosts: ["api.example.com"],
      maximumResponseBytes: 1024,
      fetcher
    })).rejects.toMatchObject({ retryable: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("enforces the streamed response byte ceiling", async () => {
    const fetcher = vi.fn(async () => new Response("too large", { headers: { "content-length": "9" } }));
    await expect(adapterRequest({
      url: "https://api.example.com/data",
      allowedHosts: ["api.example.com"],
      maximumResponseBytes: 4,
      fetcher
    })).rejects.toThrow("exceeded the configured byte limit");
  });

  it("disables automatic redirects so an allowlisted endpoint cannot redirect to another host", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      return new Response(null, { status: 302, headers: { location: "https://evil.example/private" } });
    });
    await expect(adapterRequest({
      url: "https://api.example.com/data",
      allowedHosts: ["api.example.com"],
      maximumResponseBytes: 1024,
      fetcher
    })).rejects.toMatchObject({ status: 302, retryable: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed byte ceilings and credential-bearing URLs before transport", async () => {
    const fetcher = vi.fn(async () => new Response("ok"));
    await expect(adapterRequest({
      url: "https://user:password@api.example.com/data",
      allowedHosts: ["api.example.com"],
      maximumResponseBytes: 1024,
      fetcher
    })).rejects.toThrow("user information");
    await expect(adapterRequest({
      url: "https://api.example.com/data",
      allowedHosts: ["api.example.com"],
      maximumResponseBytes: Number.NaN,
      fetcher
    })).rejects.toThrow("maximumResponseBytes");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

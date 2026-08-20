import { describe, expect, it, vi } from "vitest";
import { GeminiAdapter, classifyStatus } from "../adapters/canon-mcp-gateway/gemini.js";

describe("GeminiAdapter", () => {
  it("fails closed when the credential is absent", async () => {
    const result = await new GeminiAdapter().ask("hello");
    expect(result.state).toBe("AUTH_REQUIRED");
    expect(result.receipt.redactions).toContain("credential");
  });

  it("returns bounded text and a redacted receipt", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "grounded result" }] } }]
    }), { status: 200 })) as unknown as typeof fetch;

    const result = await new GeminiAdapter({ apiKey: "test-only", fetchImpl }).ask("hello");
    expect(result.state).toBe("CONNECTED");
    expect(result.data?.text).toBe("grounded result");
    expect(result.receipt.redactions).toContain("prompt");
    expect(JSON.stringify(result)).not.toContain("test-only");
  });

  it("does not classify provider failures as empty results", () => {
    expect(classifyStatus(401)).toBe("AUTH_REQUIRED");
    expect(classifyStatus(429)).toBe("RATE_LIMITED");
    expect(classifyStatus(503)).toBe("DEGRADED");
  });
});

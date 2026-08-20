import { describe, expect, it, vi } from "vitest";
import { WorkIqAdapter, classifyWorkIqError, isReadPath } from "../adapters/canon-mcp-gateway/workiq.js";

describe("WorkIqAdapter", () => {
  it("requires a configured transport", async () => {
    expect((await new WorkIqAdapter().ask("status")).state).toBe("AUTH_REQUIRED");
  });

  it("exposes only read-oriented tools", async () => {
    const call = vi.fn(async () => ({ id: "document-1" }));
    const adapter = new WorkIqAdapter({ transport: { call } });
    expect((await adapter.fetch("/documents/document-1")).state).toBe("CONNECTED");
    expect(call).toHaveBeenCalledWith("fetch", { path: "/documents/document-1" });
  });

  it("blocks mutation-shaped paths before transport", async () => {
    const call = vi.fn();
    const adapter = new WorkIqAdapter({ transport: { call } });
    expect((await adapter.fetch("/messages/send")).state).toBe("BLOCKED");
    expect(call).not.toHaveBeenCalled();
  });

  it("classifies consent and billing gates truthfully", () => {
    expect(classifyWorkIqError(new Error("403 admin consent required"))).toBe("CONSENT_REQUIRED");
    expect(classifyWorkIqError(new Error("billing policy missing"))).toBe("CONSENT_REQUIRED");
    expect(isReadPath("/documents/123")).toBe(true);
    expect(isReadPath("/documents/delete/123")).toBe(false);
  });
});

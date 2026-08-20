import { describe, expect, it } from "vitest";
import { assertAllowed } from "../adapters/canon-mcp-gateway/policy.js";

describe("CANON MCP gateway policy", () => {
  it("allows bounded Gemini inference", () => {
    expect(() => assertAllowed({ operation: "gemini_ask", source: "gemini", authority: "read_inference", limit: 1 })).not.toThrow();
  });

  it("blocks cross-provider execution", () => {
    expect(() => assertAllowed({ operation: "gemini_ask", source: "workiq", authority: "read_inference" })).toThrow(/BLOCKED/);
  });

  it("blocks retrieval above the gateway maximum", () => {
    expect(() => assertAllowed({ operation: "source_read", source: "gemini", authority: "read_bounded", limit: 101 })).toThrow(/BLOCKED/);
  });
});

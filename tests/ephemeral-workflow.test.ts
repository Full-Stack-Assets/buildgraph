import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const workflow = parse(readFileSync(
  resolve(import.meta.dirname, "../.github/workflows/canon-ephemeral-sync.yml"),
  "utf8"
)) as {
  on?: { push?: { branches?: string[]; paths?: string[] } };
  permissions?: Record<string, string>;
  jobs?: Record<string, { env?: Record<string, string> }>;
};

describe("Canon ephemeral workflow", () => {
  it("runs only the credentialed Gemini adapter in the ephemeral profile", () => {
    expect(workflow.on?.push).toEqual({
      branches: ["main"],
      paths: [".github/workflows/canon-ephemeral-sync.yml"]
    });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs?.sync?.env?.CANON_SYNC_ADAPTERS).toBe("gemini");
    expect(workflow.jobs?.retrieval?.env?.CANON_SYNC_ADAPTERS).toBe("gemini");
    expect(workflow.jobs?.sync?.env?.COPILOT_GITHUB_TOKEN).toBeUndefined();
    expect(workflow.jobs?.retrieval?.env?.COPILOT_GITHUB_TOKEN).toBeUndefined();
  });
});

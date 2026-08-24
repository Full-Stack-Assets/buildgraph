import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const workflow = parse(readFileSync(
  resolve(import.meta.dirname, "../.github/workflows/canon-ephemeral-sync.yml"),
  "utf8"
)) as {
  permissions?: Record<string, string>;
  jobs?: Record<string, { env?: Record<string, string> }>;
};

describe("Canon ephemeral workflow", () => {
  it("grants and explicitly binds the short-lived Copilot request token", () => {
    expect(workflow.permissions).toEqual({
      contents: "read",
      "copilot-requests": "write"
    });
    expect(workflow.jobs?.sync?.env?.COPILOT_GITHUB_TOKEN).toBe("${{ github.token }}");
    expect(workflow.jobs?.retrieval?.env?.COPILOT_GITHUB_TOKEN).toBe("${{ github.token }}");
  });
});

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

const requiredPaths = [
  "README.md",
  "SECURITY.md",
  "CODEOWNERS",
  ".github/workflows/ci.yml",
  "docs/adr/ADR-001-buildgraph-v0-scope.md",
  "docs/IMPLEMENTATION_STATUS.md",
  "docs/FURTHER_DEVELOPMENT_PLAN.md",
  "docs/ACQUISITION_READINESS.md",
  "docs/CLAIM_EVIDENCE_LEDGER.md",
  "schemas",
  "registry",
  "policies",
  "adapters",
  "graph",
  "router",
  "evals",
  "fixtures",
  "tests"
];

describe("BuildGraph foundation", () => {
  it("contains the required governance and implementation boundaries", () => {
    for (const requiredPath of requiredPaths) {
      expect(existsSync(resolve(root, requiredPath)), `missing ${requiredPath}`).toBe(true);
    }
  });
});

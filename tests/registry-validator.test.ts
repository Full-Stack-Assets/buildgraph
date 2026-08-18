import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const validator = resolve(root, "scripts", "validate-registry.ts");

function runRegistryValidation(fixtureDirectory: string) {
  return spawnSync(process.execPath, ["--import", "tsx", validator], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      BUILDGRAPH_REGISTRY_DIR: resolve(root, fixtureDirectory)
    }
  });
}

describe("registry validator", () => {
  it("accepts a complete manifest", () => {
    const result = runRegistryValidation("fixtures/registry-valid");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("BuildGraph registry validation passed for 1 manifest(s).");
  });

  it("fails closed for a manifest missing required owner fields", () => {
    const result = runRegistryValidation("fixtures/registry-invalid");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("BuildGraph registry validation failed:");
    expect(result.stderr).toContain("accountable_human_owner");
  });
});

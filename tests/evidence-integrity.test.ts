import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function loadManifests(directory: string): Array<Record<string, unknown>> {
  return readdirSync(resolve(root, directory))
    .filter((path) => path.endsWith(".yaml"))
    .map((path) => parse(readFileSync(resolve(root, directory, path), "utf8")) as Record<string, unknown>);
}

describe("canonical evidence integrity", () => {
  it("matches every registered local artifact to its declared checksum", () => {
    for (const manifest of loadManifests("registry/artifacts")) {
      const spec = manifest.spec as { uri: string; checksum_sha256: string };
      const artifactPath = resolve(root, spec.uri);

      expect(existsSync(artifactPath), `${spec.uri} must exist`).toBe(true);
      expect(sha256(artifactPath), `${spec.uri} checksum must match`).toBe(spec.checksum_sha256);
    }
  });

  it("matches local evidence sources and records a successful tested run", () => {
    for (const manifest of loadManifests("registry/evidence")) {
      const spec = manifest.spec as { source_uri: string; checksum_sha256: string };
      const evidencePath = resolve(root, spec.source_uri);

      expect(existsSync(evidencePath), `${spec.source_uri} must exist`).toBe(true);
      expect(sha256(evidencePath), `${spec.source_uri} checksum must match`).toBe(spec.checksum_sha256);
    }

    const run = loadManifests("registry/execution-runs")[0] as {
      spec?: { status?: string; completed_at?: string | null };
    };
    const verification = loadManifests("registry/verifications")[0] as {
      spec?: { state?: string };
    };

    expect(run.spec?.status).toBe("SUCCEEDED");
    expect(run.spec?.completed_at).toBeTruthy();
    expect(verification.spec?.state).toBe("TESTED");
  });
});

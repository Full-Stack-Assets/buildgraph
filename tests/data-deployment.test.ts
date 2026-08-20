import { describe, expect, it } from "vitest";
import { buildDataAdapterFromEnvironment, buildDataAdaptersFromEnvironment } from "../adapters/data/deployment.js";

describe("data adapter deployment loader", () => {
  it("requires explicit adapter selection instead of assuming every provider", () => {
    expect(() => buildDataAdaptersFromEnvironment({})).toThrow("CANON_SYNC_ADAPTERS");
    const adapters = buildDataAdaptersFromEnvironment({
      CANON_SYNC_ADAPTERS: "grok",
      XAI_API_KEY: "test-key",
      CANON_ENABLE_WRITES: "false",
      CANON_ENABLE_INFERENCE: "false"
    });
    expect(adapters.map((adapter) => adapter.capabilities.adapterId)).toEqual(["grok"]);
  });

  it("validates provider byte limits and scoped Copilot working directories", () => {
    expect(() => buildDataAdapterFromEnvironment("grok", {
      XAI_API_KEY: "test-key",
      XAI_MAX_ITEM_BYTES: "not-a-number"
    })).toThrow("XAI_MAX_ITEM_BYTES");
    expect(() => buildDataAdapterFromEnvironment("copilot", {
      COPILOT_WORKING_DIRECTORY: "/"
    })).toThrow("cannot be a filesystem root");
  });

  it("rejects CloudKit database modes that cannot provide the custom-zone cursor contract", () => {
    expect(() => buildDataAdapterFromEnvironment("icloud", {
      CLOUDKIT_CONTAINER_ID: "iCloud.com.example.canon",
      CLOUDKIT_DATABASE: "public",
      CLOUDKIT_API_TOKEN: "api-token"
    })).toThrow("requires CLOUDKIT_DATABASE=private");
  });
});

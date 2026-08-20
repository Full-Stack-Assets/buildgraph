import { describe, expect, it } from "vitest";
import { authorizeInference, authorizeWrite } from "../adapters/data/authorization.js";
import type { ActionGrant, InferenceRequest, WriteRequest } from "../adapters/data/core.js";

const now = new Date("2026-08-20T12:00:00.000Z");

function grant(overrides: Partial<ActionGrant> = {}): ActionGrant {
  return {
    grantId: "grant-1",
    adapterId: "grok",
    operations: ["create", "update", "inference"],
    resourcePrefixes: ["collection:collection_approved"],
    maximumBytes: 1024,
    issuedAt: "2026-08-20T11:59:00.000Z",
    expiresAt: "2026-08-20T12:01:00.000Z",
    approvalRef: "APR-1",
    ...overrides
  };
}

function write(destination = "collection:collection_approved"): WriteRequest {
  return {
    operation: "create",
    destination,
    name: "document.txt",
    mimeType: "text/plain",
    bytes: new TextEncoder().encode("hello"),
    metadata: {},
    expectedVersion: null,
    idempotencyKey: "idem-write-1",
    approvalRef: null
  };
}

describe("data adapter authority", () => {
  it("fails closed when the deployment write switch is off", () => {
    expect(() => authorizeWrite("grok", write(), grant(), {
      writesEnabled: false,
      inferenceEnabled: false,
      requireApprovalFor: [],
      clock: () => now
    })).toThrow("writes are disabled");
  });

  it("uses component-bounded resource matching", () => {
    expect(() => authorizeWrite("grok", write("collection:collection_approved-other"), grant(), {
      writesEnabled: true,
      inferenceEnabled: false,
      requireApprovalFor: [],
      clock: () => now
    })).toThrow("outside the granted resource scope");
  });

  it("requires a matching approval reference for consequential updates", () => {
    const request = { ...write(), operation: "update" as const, expectedVersion: "v1", approvalRef: "APR-wrong" };
    expect(() => authorizeWrite("grok", request, grant(), {
      writesEnabled: true,
      inferenceEnabled: false,
      requireApprovalFor: ["update"],
      clock: () => now
    })).toThrow("matching approval reference");
  });

  it("binds inference to an expiring adapter-specific grant", () => {
    const request: InferenceRequest = {
      prompt: "Summarize the approved corpus.",
      systemInstruction: null,
      resourceRefs: ["collection:collection_approved"],
      idempotencyKey: "idem-infer-1",
      approvalRef: null,
      metadata: {}
    };
    expect(authorizeInference("grok", request, grant(), {
      writesEnabled: false,
      inferenceEnabled: true,
      requireApprovalFor: [],
      clock: () => now
    }).payloadSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(() => authorizeInference("grok", request, grant({ expiresAt: now.toISOString() }), {
      writesEnabled: false,
      inferenceEnabled: true,
      requireApprovalFor: [],
      clock: () => now
    })).toThrow("not currently valid");
  });

  it("rejects inference when any resource is outside the grant", () => {
    const request: InferenceRequest = {
      prompt: "Compare the corpora.",
      systemInstruction: "Use only granted evidence.",
      resourceRefs: ["collection:collection_approved", "collection:collection_unapproved"],
      idempotencyKey: "idem-infer-mixed-scope",
      approvalRef: null,
      metadata: {}
    };
    expect(() => authorizeInference("grok", request, grant(), {
      writesEnabled: false,
      inferenceEnabled: true,
      requireApprovalFor: [],
      clock: () => now
    })).toThrow("one or more inference resources");
  });

  it("rejects malformed byte limits instead of treating NaN as unlimited", () => {
    expect(() => authorizeWrite("grok", write(), grant({ maximumBytes: Number.NaN }), {
      writesEnabled: true,
      inferenceEnabled: false,
      requireApprovalFor: [],
      clock: () => now
    })).toThrow("non-negative safe integer");
  });
});

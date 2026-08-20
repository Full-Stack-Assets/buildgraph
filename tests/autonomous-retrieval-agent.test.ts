import { describe, expect, it, vi } from "vitest";
import type { AIDataAdapter } from "../adapters/data/core.js";
import {
  AutonomousRetrievalAgent,
  type AutonomousInferenceEvidence,
  type AutonomousRetrievalJob,
  type InferenceEvidenceStore,
  type RetrievalJobState,
  type RetrievalStateStore
} from "../adapters/data/retrieval-agent.js";

class MemoryState implements RetrievalStateStore {
  readonly values = new Map<string, RetrievalJobState>();
  async get(jobId: string): Promise<RetrievalJobState | null> { return this.values.get(jobId) ?? null; }
  async put(state: RetrievalJobState): Promise<void> { this.values.set(state.jobId, state); }
}

class MemoryEvidence implements InferenceEvidenceStore {
  readonly values: AutonomousInferenceEvidence[] = [];
  async put(value: AutonomousInferenceEvidence): Promise<string> {
    this.values.push(value);
    return "a".repeat(64);
  }
}

describe("AutonomousRetrievalAgent", () => {
  it("runs due inference under a bound grant, stores evidence, then honors cadence", async () => {
    const infer = vi.fn(async () => ({
      receipt: {
        receiptId: "provider-receipt-1", adapterId: "grok" as const, operation: "inference" as const,
        idempotencyKey: "idem-1", payloadSha256: "b".repeat(64), grantId: "grant-1", approvalRef: null,
        providerObjectId: "response-1", providerVersion: "grok-test", status: "SUCCEEDED" as const,
        startedAt: "2026-08-20T12:00:00.000Z", completedAt: "2026-08-20T12:00:00.000Z", evidence: {}
      },
      outputText: "grounded summary",
      providerResponseId: "response-1",
      citations: [{ source: "collection:approved" }],
      rawSummary: {}
    }));
    const adapter: AIDataAdapter = {
      capabilities: {
        adapterId: "grok", evidenceState: "TESTED", operations: ["inference"], supportsIncrementalCursor: false,
        supportsContentDownload: false, supportsContinuousSync: true, maximumItemBytes: 1024, constraints: []
      },
      healthCheck: async () => ({
        adapterId: "grok", status: "HEALTHY", checkedAt: "2026-08-20T12:00:00.000Z", latencyMs: 0,
        authenticated: true, readVerified: true, writeConfigured: false, detail: "test", evidence: {}
      }),
      listChanges: async () => ({ adapterId: "grok", observedAt: "2026-08-20T12:00:00.000Z", items: [], nextCursor: null, hasMore: false }),
      read: async () => { throw new Error("not used"); },
      write: async () => { throw new Error("not used"); },
      infer
    };
    const state = new MemoryState();
    const evidence = new MemoryEvidence();
    const agent = new AutonomousRetrievalAgent({ adapters: [adapter], stateStore: state, evidenceStore: evidence, clock: () => new Date("2026-08-20T12:00:00.000Z") });
    const job: AutonomousRetrievalJob = {
      jobId: "daily-summary",
      adapterId: "grok",
      intervalMs: 60_000,
      request: {
        prompt: "Summarize approved changes.", systemInstruction: null, resourceRefs: ["collection:approved"],
        idempotencyKey: "idem-1", approvalRef: null, metadata: {}
      },
      grant: {
        grantId: "grant-1", adapterId: "grok", operations: ["inference"], resourcePrefixes: ["collection:approved"],
        maximumBytes: 1024, issuedAt: "2026-08-20T11:59:00.000Z", expiresAt: "2026-08-20T12:01:00.000Z", approvalRef: null
      }
    };

    await expect(agent.runDue([job])).resolves.toMatchObject([{ status: "SUCCEEDED", providerReceiptId: "provider-receipt-1" }]);
    await expect(agent.runDue([job])).resolves.toMatchObject([{ status: "SKIPPED" }]);
    expect(infer).toHaveBeenCalledTimes(1);
    expect(evidence.values[0]).toMatchObject({ promptSha256: expect.stringMatching(/^[a-f0-9]{64}$/), outputText: "grounded summary" });
  });

  it("validates every job and duplicate ID before invoking any provider", async () => {
    const infer = vi.fn(async () => { throw new Error("must not run"); });
    const adapter = {
      capabilities: {
        adapterId: "grok" as const, evidenceState: "TESTED" as const, operations: ["inference" as const], supportsIncrementalCursor: false,
        supportsContentDownload: false, supportsContinuousSync: true, maximumItemBytes: 1024, constraints: []
      },
      healthCheck: async () => { throw new Error("not used"); },
      listChanges: async () => { throw new Error("not used"); },
      read: async () => { throw new Error("not used"); },
      write: async () => { throw new Error("not used"); },
      infer
    } satisfies AIDataAdapter;
    const agent = new AutonomousRetrievalAgent({ adapters: [adapter], stateStore: new MemoryState(), evidenceStore: new MemoryEvidence() });
    const job: AutonomousRetrievalJob = {
      jobId: "duplicate-job",
      adapterId: "grok",
      intervalMs: 60_000,
      request: { prompt: "Summarize.", systemInstruction: null, resourceRefs: ["collection:approved"], idempotencyKey: "idem", approvalRef: null, metadata: {} },
      grant: {
        grantId: "grant", adapterId: "grok", operations: ["inference"], resourcePrefixes: ["collection:approved"], maximumBytes: 1024,
        issuedAt: "2026-08-20T11:59:00.000Z", expiresAt: "2026-08-20T12:01:00.000Z", approvalRef: null
      }
    };

    await expect(agent.runDue([job, job])).rejects.toThrow("duplicate retrieval jobId");
    expect(infer).not.toHaveBeenCalled();
  });
});

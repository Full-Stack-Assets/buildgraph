import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataItem } from "../adapters/data/core.js";
import { SupabaseCanonSink, SupabaseClient, SupabaseDeadLetterStore } from "../adapters/data/supabase.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function client(): SupabaseClient {
  return new SupabaseClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    bucket: "canon-objects",
    maximumItemBytes: 1_024
  });
}

const item: DataItem = {
  adapterId: "copilot",
  externalId: "session-1",
  version: "2026-08-24T12:00:00.000Z",
  name: "session-1",
  mimeType: "application/vnd.github.copilot.session+json",
  sizeBytes: null,
  createdAt: "2026-08-24T11:00:00.000Z",
  modifiedAt: "2026-08-24T12:00:00.000Z",
  contentHash: null,
  contentAvailability: "session-events",
  deleted: false,
  sourceUri: "copilot://sessions/session-1",
  metadata: {}
};

describe("Supabase adapter persistence", () => {
  it("writes dead letters using only database column names", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        run_id: "run-1",
        adapter_id: "copilot",
        external_id_hash: null,
        phase: "list",
        occurred_at: "2026-08-24T12:00:00.000Z",
        error_class: "Error",
        message: "Copilot request denied",
        retryable: false
      });
      return new Response(null, { status: 201 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await new SupabaseDeadLetterStore(client()).put({
      runId: "run-1",
      adapterId: "copilot",
      externalIdHash: null,
      phase: "list",
      occurredAt: "2026-08-24T12:00:00.000Z",
      errorClass: "Error",
      message: "Copilot request denied",
      retryable: false
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("surfaces bounded PostgREST diagnostics without response control characters", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      code: "PGRST204",
      message: "Could not find the 'runId' column\n"
    }), { status: 400 })) as typeof fetch;

    await expect(client().rest("/rest/v1/canon_dead_letters")).rejects.toThrow(
      "Supabase request failed (400): PGRST204: Could not find the 'runId' column "
    );
  });

  it("decodes flattened persisted rows and recognizes an unchanged replay", async () => {
    const contentHash = "a".repeat(64);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("canon_ingested_records?") ) {
        return new Response(JSON.stringify([{
          source: { ...item, contentHash },
          content: { hashSha256: contentHash, objectPath: null, unavailableReason: null },
          first_observed_at: "2026-08-24T11:00:00.000Z",
          last_observed_at: "2026-08-24T12:00:00.000Z",
          last_run_id: "run-previous"
        }]), { status: 200 });
      }
      return new Response(null, { status: 201 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const receipt = await new SupabaseCanonSink(client()).ingest("run-2", { ...item, contentHash }, {
      item: { ...item, contentHash },
      bytes: null,
      contentHash,
      unavailableReason: null
    }, "2026-08-24T13:00:00.000Z");

    expect(receipt.status).toBe("UNCHANGED");
  });
});

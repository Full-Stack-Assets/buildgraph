import { describe, expect, it, vi } from "vitest";
import type { ActionGrant } from "../adapters/data/core.js";
import { CloudKitDataAdapter } from "../adapters/data/providers/cloudkit.js";
import { CopilotDataAdapter, type CopilotClientLike, type CopilotSessionLike } from "../adapters/data/providers/copilot.js";
import { GeminiDataAdapter } from "../adapters/data/providers/gemini.js";
import { GrokDataAdapter } from "../adapters/data/providers/grok.js";

const now = new Date("2026-08-20T12:00:00.000Z");

function grant(adapterId: ActionGrant["adapterId"], prefixes: string[], operations: ActionGrant["operations"]): ActionGrant {
  return {
    grantId: `grant-${adapterId}`,
    adapterId,
    operations,
    resourcePrefixes: prefixes,
    maximumBytes: 1024 * 1024,
    issuedAt: "2026-08-20T11:59:00.000Z",
    expiresAt: "2026-08-20T12:01:00.000Z",
    approvalRef: "APR-1"
  };
}

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json", ...init.headers }, ...init });
}

describe("Grok data adapter", () => {
  it("lists, downloads, writes, and runs retrieval-scoped inference", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.host === "management-api.x.ai" && url.pathname.includes("/documents/") && (init?.method ?? "GET") === "GET") {
        return json({ status: "DOCUMENT_STATUS_PROCESSED" });
      }
      if (url.host === "management-api.x.ai") return json({});
      if (url.pathname === "/v1/files" && (init?.method ?? "GET") === "GET") {
        return json({ data: [{ id: "file_abc", filename: "brief.txt", bytes: 5, created_at: 1_776_859_200 }] });
      }
      if (url.pathname === "/v1/files/file_abc/content") return new Response("hello");
      if (url.pathname === "/v1/files" && init?.method === "POST") return json({ id: "file_new" });
      if (url.pathname === "/v1/responses") {
        expect(JSON.parse(String(init?.body))).toMatchObject({ store: false, tools: [{ type: "file_search" }] });
        return json({ id: "resp_1", model: "grok-test", citations: ["collections://collection_approved/files/file_abc"], output: [{ content: [{ text: "grounded answer" }] }] });
      }
      throw new Error(`unexpected Grok URL ${url}`);
    });
    const adapter = new GrokDataAdapter({
      apiKey: "xai-test",
      managementApiKey: "xai-management-test",
      collectionIds: ["collection_approved"],
      model: "grok-test",
      fetcher,
      clock: () => now,
      actionPolicy: { writesEnabled: true, inferenceEnabled: true }
    });
    const page = await adapter.listChanges(null);
    expect(page.items).toHaveLength(1);
    await expect(adapter.read(page.items[0]!)).resolves.toMatchObject({ contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    await expect(adapter.write({
      operation: "create",
      destination: "collection:collection_approved",
      name: "new.txt",
      mimeType: "text/plain",
      bytes: new TextEncoder().encode("new"),
      metadata: {},
      expectedVersion: null,
      idempotencyKey: "idem-grok-write",
      approvalRef: null
    }, grant("grok", ["collection:collection_approved"], ["create", "inference"]))).resolves.toMatchObject({ status: "SUCCEEDED", providerObjectId: "file_new" });
    const uploadCall = fetcher.mock.calls.find(([input, init]) => new URL(String(input)).pathname === "/v1/files" && init?.method === "POST");
    expect((uploadCall?.[1]?.body as FormData).get("purpose")).toBe("assistants");
    await expect(adapter.infer({
      prompt: "answer",
      systemInstruction: null,
      resourceRefs: ["collection:collection_approved"],
      idempotencyKey: "idem-grok-infer",
      approvalRef: null,
      metadata: {}
    }, grant("grok", ["collection:collection_approved"], ["create", "inference"]))).resolves.toMatchObject({
      outputText: "grounded answer",
      citations: ["collections://collection_approved/files/file_abc"]
    });
  });

  it("rejects an unallowlisted collection before uploading bytes", async () => {
    const fetcher = vi.fn(async () => json({}));
    const adapter = new GrokDataAdapter({
      apiKey: "xai-test",
      managementApiKey: "xai-management-test",
      collectionIds: ["collection_approved"],
      fetcher,
      clock: () => now,
      actionPolicy: { writesEnabled: true }
    });
    await expect(adapter.write({
      operation: "create",
      destination: "collection:collection_unapproved",
      name: "source.txt",
      mimeType: "text/plain",
      bytes: new Uint8Array([1]),
      metadata: {},
      expectedVersion: null,
      idempotencyKey: "idem-unapproved-collection",
      approvalRef: null
    }, grant("grok", ["collection:collection_unapproved"], ["create"]))).rejects.toThrow("deployment allowlist");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Gemini data adapter", () => {
  it("preserves Files as metadata-only while supporting upload, File Search import, and inference", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1beta/files" && (init?.method ?? "GET") === "GET") {
        return json({ files: [{ name: "files/f1", displayName: "source.pdf", mimeType: "application/pdf", sizeBytes: "10", createTime: now.toISOString(), sha256Hash: "abc" }] });
      }
      if (url.pathname === "/v1beta/files/f1") return json({ name: "files/f1", displayName: "source.pdf", mimeType: "application/pdf", sizeBytes: "10", createTime: now.toISOString(), sha256Hash: "abc" });
      if (url.pathname === "/upload/v1beta/files" && url.host === "generativelanguage.googleapis.com") {
        return json({}, { headers: { "x-goog-upload-url": "https://upload.googleapis.com/upload/session-1" } });
      }
      if (url.host === "upload.googleapis.com") return json({ file: { name: "files/f2", updateTime: now.toISOString() } });
      if (url.pathname.endsWith(":importFile")) return json({ name: "operations/import-1" });
      if (url.pathname === "/v1beta/operations/import-1") return json({ name: "operations/import-1", done: true });
      if (url.pathname === "/v1beta/interactions") {
        expect(JSON.parse(String(init?.body))).toMatchObject({ store: false, tools: [{ type: "file_search" }] });
        return json({ id: "interaction-1", steps: [{ type: "model_output", content: [{ text: "indexed answer", annotations: [{ source: "f2" }] }] }] });
      }
      throw new Error(`unexpected Gemini URL ${url}`);
    });
    const store = "fileSearchStores/store_1";
    const adapter = new GeminiDataAdapter({
      apiKey: "gemini-test",
      fileSearchStoreNames: [store],
      model: "gemini-test",
      fetcher,
      clock: () => now,
      actionPolicy: { writesEnabled: true, inferenceEnabled: true }
    });
    const listed = await adapter.listChanges(null);
    const read = await adapter.read(listed.items[0]!);
    expect(read.bytes).toBeNull();
    expect(read.unavailableReason).toContain("does not expose original uploaded file bytes");
    await expect(adapter.write({
      operation: "create",
      destination: store,
      name: "source.pdf",
      mimeType: "application/pdf",
      bytes: new Uint8Array([1, 2, 3]),
      metadata: {},
      expectedVersion: null,
      idempotencyKey: "idem-gemini-write",
      approvalRef: null
    }, grant("gemini", [store], ["create", "inference"]))).resolves.toMatchObject({ status: "SUCCEEDED", providerObjectId: "files/f2" });
    await expect(adapter.infer({
      prompt: "answer",
      systemInstruction: null,
      resourceRefs: [store],
      idempotencyKey: "idem-gemini-infer",
      approvalRef: null,
      metadata: {}
    }, grant("gemini", [store], ["create", "inference"]))).resolves.toMatchObject({ outputText: "indexed answer", citations: [{ source: "f2" }] });
  });

  it("walks Files and every configured File Search store in one cursor cycle", async () => {
    const store1 = "fileSearchStores/store_1";
    const store2 = "fileSearchStores/store_2";
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1beta/files") {
        return json({ files: [{ name: "files/raw", displayName: "raw.txt", createTime: "2026-08-20T10:00:00.000Z" }] });
      }
      if (url.pathname === `/v1beta/${store1}/documents`) {
        return json({ documents: [{ name: `${store1}/documents/doc_1`, displayName: "one.txt", updateTime: "2026-08-20T11:00:00.000Z" }] });
      }
      if (url.pathname === `/v1beta/${store2}/documents`) {
        return json({ documents: [{ name: `${store2}/documents/doc_2`, displayName: "two.txt", updateTime: "2026-08-20T12:00:00.000Z" }] });
      }
      throw new Error(`unexpected Gemini URL ${url}`);
    });
    const adapter = new GeminiDataAdapter({ apiKey: "gemini-test", fileSearchStoreNames: [store1, store2], fetcher, clock: () => now });
    const files = await adapter.listChanges(null);
    const firstStore = await adapter.listChanges(files.nextCursor);
    const secondStore = await adapter.listChanges(firstStore.nextCursor);
    expect(files).toMatchObject({ hasMore: true, items: [{ externalId: "files/raw" }] });
    expect(firstStore).toMatchObject({ hasMore: true, items: [{ externalId: `${store1}/documents/doc_1` }] });
    expect(secondStore).toMatchObject({ hasMore: false, items: [{ externalId: `${store2}/documents/doc_2` }] });
  });

  it("rejects an unallowlisted store before starting an upload", async () => {
    const fetcher = vi.fn(async () => json({}));
    const adapter = new GeminiDataAdapter({
      apiKey: "gemini-test",
      fileSearchStoreNames: ["fileSearchStores/approved"],
      fetcher,
      clock: () => now,
      actionPolicy: { writesEnabled: true }
    });
    await expect(adapter.write({
      operation: "create",
      destination: "fileSearchStores/unapproved",
      name: "source.pdf",
      mimeType: "application/pdf",
      bytes: new Uint8Array([1]),
      metadata: {},
      expectedVersion: null,
      idempotencyKey: "idem-unapproved-store",
      approvalRef: null
    }, grant("gemini", ["fileSearchStores/unapproved"], ["create"]))).rejects.toThrow("deployment allowlist");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Copilot data adapter", () => {
  it("reads persisted sessions and denies tools in adapter-managed writes", async () => {
    const optionsSeen: Record<string, unknown>[] = [];
    const session = (sessionId: string): CopilotSessionLike => ({
      sessionId,
      getEvents: async () => [{ type: "assistant.message", data: { content: "done" } }],
      sendAndWait: async ({ prompt }) => ({ text: `reply:${prompt}` }),
      disconnect: async () => undefined
    });
    const client: CopilotClientLike = {
      ping: async () => ({ message: "ok" }),
      stop: async () => undefined,
      listSessions: async () => [{ sessionId: "session-1", summary: "Test", startTime: new Date("2026-08-20T11:00:00.000Z"), modifiedTime: now }],
      createSession: async (options) => { optionsSeen.push(options); return session("session-new"); },
      resumeSession: async (id, options = {}) => { optionsSeen.push(options); return session(id); }
    };
    const adapter = new CopilotDataAdapter({
      clientFactory: async () => client,
      clock: () => now,
      actionPolicy: { writesEnabled: true, inferenceEnabled: true }
    });
    const page = await adapter.listChanges();
    expect(page.items[0]?.externalId).toBe("session-1");
    expect(page.items[0]?.modifiedAt).toBe(now.toISOString());
    await expect(adapter.listChanges(page.nextCursor)).resolves.toMatchObject({ items: [] });
    await expect(adapter.read(page.items[0]!)).resolves.toMatchObject({ bytes: expect.any(Uint8Array) });
    await expect(adapter.write({
      operation: "create",
      destination: "session:new",
      name: "prompt.txt",
      mimeType: "text/plain",
      bytes: new TextEncoder().encode("hello"),
      metadata: {},
      expectedVersion: null,
      idempotencyKey: "idem-copilot-write",
      approvalRef: null
    }, grant("copilot", ["session:"], ["create", "inference"]))).resolves.toMatchObject({ providerObjectId: "session-new" });
    expect(optionsSeen.every((options) => Array.isArray(options.availableTools) && options.availableTools.length === 0)).toBe(true);
  });

  it("keeps same-timestamp cursors bounded while safely replaying overflow sessions", async () => {
    const sessions = Array.from({ length: 500 }, (_, index) => ({
      sessionId: `session-${String(index).padStart(4, "0")}`,
      modifiedTime: now
    }));
    const client: CopilotClientLike = {
      stop: async () => undefined,
      listSessions: async () => sessions,
      createSession: async () => { throw new Error("not used"); },
      resumeSession: async () => { throw new Error("not used"); }
    };
    const adapter = new CopilotDataAdapter({ clientFactory: async () => client, clock: () => now });
    const first = await adapter.listChanges();
    expect(first.nextCursor?.length).toBeLessThan(16_384);
    await expect(adapter.listChanges(first.nextCursor)).resolves.toMatchObject({ items: expect.any(Array) });
    const second = await adapter.listChanges(first.nextCursor);
    expect(second.items).toHaveLength(372);
  });

  it("classifies a missing optional SDK as unreachable rather than unauthenticated", async () => {
    const adapter = new CopilotDataAdapter({
      clientFactory: async () => {
        throw new Error("GitHub Copilot SDK is not installed; install @github/copilot-sdk and authenticate Copilot CLI for this deployment");
      },
      clock: () => now
    });

    await expect(adapter.healthCheck()).resolves.toMatchObject({
      status: "UNREACHABLE",
      authenticated: false,
      readVerified: false
    });
  });
});

describe("CloudKit data adapter", () => {
  it("uses custom-zone cursors, asset reads, and conflict-safe record writes", async () => {
    const modifyBodies: unknown[] = [];
    const assetBodies: unknown[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.host === "asset.icloud-content.com") {
        if (init?.method === "POST") return json({ singleFile: { fileChecksum: "asset-checksum" } });
        return new Response("icloud bytes");
      }
      if (url.pathname.endsWith("/changes/zone")) {
        return json({ zones: [{ syncToken: "token-1", moreComing: false, records: [{
          recordName: "record-1",
          recordType: "CanonDocument",
          recordChangeTag: "v1",
          created: { timestamp: now.valueOf() },
          modified: { timestamp: now.valueOf() },
          fields: {
            name: { value: "phone.txt" }, mimeType: { value: "text/plain" }, byteCount: { value: 12 },
            contentHash: { value: "source-hash" }, payload: { value: { downloadURL: "https://asset.icloud-content.com/download/record-1", size: 12 } }
          }
        }] }] });
      }
      if (url.pathname.endsWith("/records/lookup")) {
        return json({ records: [{ recordName: "record-1", recordType: "CanonDocument", recordChangeTag: "v1", fields: {
          name: { value: "phone.txt" }, mimeType: { value: "text/plain" }, payload: { value: { downloadURL: "https://asset.icloud-content.com/download/record-1" } }
        } }] });
      }
      if (url.pathname.endsWith("/assets/upload")) {
        assetBodies.push(JSON.parse(String(init?.body)) as unknown);
        return json({ tokens: [{ url: "https://asset.icloud-content.com/upload/asset-1" }] });
      }
      if (url.pathname.endsWith("/records/modify")) {
        modifyBodies.push(JSON.parse(String(init?.body)) as unknown);
        return json({ records: [{ recordName: "record-2", recordChangeTag: "v2" }] });
      }
      throw new Error(`unexpected CloudKit URL ${url}`);
    });
    const adapter = new CloudKitDataAdapter({
      containerIdentifier: "iCloud.com.example.canon",
      environment: "development",
      database: "private",
      apiToken: "api-token",
      webAuthToken: "delegated-token",
      fetcher,
      clock: () => now,
      actionPolicy: { writesEnabled: true }
    });
    const page = await adapter.listChanges(null);
    expect(page.items[0]).toMatchObject({ externalId: "record-1", contentAvailability: "cloud-asset" });
    await expect(adapter.read(page.items[0]!)).resolves.toMatchObject({ bytes: expect.any(Uint8Array) });
    await expect(adapter.write({
      operation: "update",
      destination: "record:record-2",
      name: "updated.txt",
      mimeType: "text/plain",
      bytes: new TextEncoder().encode("updated"),
      metadata: { recordType: "CanonDocument" },
      expectedVersion: "v1",
      idempotencyKey: "idem-cloudkit-write",
      approvalRef: "APR-1"
    }, grant("icloud", ["record:"], ["update"]))).resolves.toMatchObject({ status: "SUCCEEDED", providerVersion: "v2" });
    expect(assetBodies[0]).toMatchObject({ tokens: [{ recordName: "record-2", recordType: "CanonDocument", fieldName: "payload" }] });
    await expect(adapter.writePhoneInstruction({
      instructionId: "instruction-1",
      localOperation: "create",
      rootGrantId: "11111111-1111-4111-8111-111111111111",
      actionGrantId: "22222222-2222-4222-8222-222222222222",
      relativePath: "approved/from-canon.txt",
      name: "from-canon.txt",
      mimeType: "text/plain",
      bytes: new TextEncoder().encode("from Canon"),
      expectedLocalSha256: null,
      expiresAt: "2026-08-20T13:00:00.000Z",
      idempotencyKey: "idem-phone-instruction",
      approvalRef: null
    }, grant("icloud", ["record:"], ["create"]))).resolves.toMatchObject({ status: "SUCCEEDED" });
    expect(modifyBodies.at(-1)).toMatchObject({
      operations: [{
        operationType: "create",
        record: {
          recordType: "CanonWriteInstruction",
          fields: {
            operation: { value: "create" },
            rootGrantID: { value: "11111111-1111-4111-8111-111111111111" },
            actionGrantID: { value: "22222222-2222-4222-8222-222222222222" },
            relativePath: { value: "approved/from-canon.txt" },
            expiresAt: { type: "TIMESTAMP" }
          }
        }
      }]
    });
  });

  it("requires delegated user authentication for private data", () => {
    expect(() => new CloudKitDataAdapter({
      containerIdentifier: "iCloud.com.example.canon",
      environment: "development",
      database: "private",
      apiToken: "api-token"
    })).toThrow("delegated web authentication token");
  });
});

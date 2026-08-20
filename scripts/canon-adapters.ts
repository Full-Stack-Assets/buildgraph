import { randomUUID } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { stableJson } from "../adapters/data/authorization.js";
import type { ActionGrant, InferenceRequest, JsonObject, WriteRequest } from "../adapters/data/core.js";
import { isAIDataAdapter, sha256Hex, utf8 } from "../adapters/data/core.js";
import {
  buildDataAdapterFromEnvironment,
  buildDataAdaptersFromEnvironment,
  type ServerAdapterId
} from "../adapters/data/deployment.js";
import {
  durableAtomicJson,
  FileProcessLease,
  readJsonFile,
  safeStoredMessage,
  validateStorageRoot,
  withinStorageRoot
} from "../adapters/data/file-store.js";
import { CloudKitDataAdapter, type PhoneWriteInstructionRequest } from "../adapters/data/providers/cloudkit.js";
import { registerBuildGraphFormats } from "./ajv-formats.js";

type WriteCommand = {
  kind: "write";
  adapterId: ServerAdapterId;
  request: Omit<WriteRequest, "bytes">;
  payloadFile: string;
  grant: ActionGrant;
};

type InferCommand = {
  kind: "infer";
  adapterId: Exclude<ServerAdapterId, "icloud">;
  request: InferenceRequest;
  grant: ActionGrant;
};

type PhoneInstructionCommand = {
  kind: "phone-instruction";
  adapterId: "icloud";
  input: Omit<PhoneWriteInstructionRequest, "bytes">;
  payloadFile: string;
  grant: ActionGrant;
};

type AdapterCommand = WriteCommand | InferCommand | PhoneInstructionCommand;

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`missing required environment variable ${name}`);
  return value;
}

function integerEnvironment(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? String(fallback));
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function fileArgument(): string {
  const index = process.argv.indexOf("--file");
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error("provide a schema-validated command JSON file with --file");
  return resolve(value);
}

async function loadCommand(): Promise<AdapterCommand> {
  const root = resolve(import.meta.dirname, "..");
  const schemaRoot = resolve(root, "schemas");
  const commandPath = fileArgument();
  const commandDetails = await lstat(commandPath);
  const maximumCommandBytes = integerEnvironment("CANON_ACTION_COMMAND_MAX_BYTES", 2 * 1024 * 1024, 1, 16 * 1024 * 1024);
  if (commandDetails.isSymbolicLink() || !commandDetails.isFile()) throw new Error("adapter command must be a regular non-symlink file");
  if (commandDetails.size > maximumCommandBytes) throw new Error("adapter command exceeds CANON_ACTION_COMMAND_MAX_BYTES");
  const [grantSchema, commandSchema, value] = await Promise.all([
    readFile(resolve(schemaRoot, "data-action-grant.schema.json"), "utf8").then((text) => JSON.parse(text) as object),
    readFile(resolve(schemaRoot, "data-adapter-command.schema.json"), "utf8").then((text) => JSON.parse(text) as object),
    readFile(commandPath).then((bytes) => {
      if (bytes.byteLength > maximumCommandBytes) throw new Error("adapter command exceeds CANON_ACTION_COMMAND_MAX_BYTES");
      return JSON.parse(bytes.toString("utf8")) as unknown;
    })
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  registerBuildGraphFormats(ajv);
  ajv.addSchema(grantSchema);
  const validate = ajv.compile(commandSchema);
  if (!validate(value)) throw new Error(`invalid adapter command: ${ajv.errorsText(validate.errors)}`);
  return value as AdapterCommand;
}

async function readScopedPayload(path: string, maximumBytes: number): Promise<Uint8Array> {
  const configuredRoot = validateStorageRoot(required("CANON_ACTION_PAYLOAD_ROOT"), "action payload");
  const root = await realpath(configuredRoot);
  const requested = isAbsolute(path) ? resolve(path) : resolve(root, path);
  const direct = await lstat(requested);
  if (direct.isSymbolicLink()) throw new Error("action payload file cannot be a symbolic link");
  const physical = await realpath(requested);
  if (physical !== root && !physical.startsWith(`${root}${sep}`)) {
    throw new Error("action payload file is outside CANON_ACTION_PAYLOAD_ROOT");
  }
  const details = await stat(physical);
  if (!details.isFile()) throw new Error("action payload must be a regular file");
  if (details.size > maximumBytes) throw new Error("action payload exceeds its adapter or grant byte limit");
  const bytes = await readFile(physical);
  if (bytes.byteLength > maximumBytes) throw new Error("action payload exceeds its adapter or grant byte limit");
  return bytes;
}

function fingerprint(command: AdapterCommand, payloadHash: string | null): string {
  const material = command.kind === "write"
    ? { kind: command.kind, adapterId: command.adapterId, request: command.request, payloadHash }
    : command.kind === "infer"
      ? { kind: command.kind, adapterId: command.adapterId, request: command.request }
      : { kind: command.kind, adapterId: command.adapterId, input: command.input, payloadHash };
  return sha256Hex(utf8(stableJson(material)));
}

function receiptFromResult(value: unknown): { receiptId: string; status: string } | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const nested = record.receipt;
  const receipt = nested !== null && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : record;
  return typeof receipt.receiptId === "string" && typeof receipt.status === "string"
    ? { receiptId: receipt.receiptId, status: receipt.status }
    : null;
}

type StoredAction = {
  schemaVersion?: unknown;
  state?: unknown;
  fingerprint?: unknown;
  idempotencyKeyHash?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
  error?: unknown;
  result?: unknown;
};

function storedAction(value: unknown): StoredAction | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as StoredAction : null;
}

async function runHealth(): Promise<void> {
  const adapters = buildDataAdaptersFromEnvironment(process.env);
  const results = await Promise.all(adapters.map((adapter) => adapter.healthCheck()));
  const report = { checkedAt: new Date().toISOString(), results };
  if (process.env.CANON_SYNC_ROOT?.trim()) {
    const root = validateStorageRoot(resolve(process.env.CANON_SYNC_ROOT), "Canon sync storage");
    await durableAtomicJson(withinStorageRoot(root, "health-receipts", `health-${randomUUID()}.json`), report);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (results.some((result) => result.status !== "HEALTHY")) process.exitCode = 2;
}

function runCapabilities(): void {
  const capabilities = buildDataAdaptersFromEnvironment(process.env).map((adapter) => adapter.capabilities);
  process.stdout.write(`${JSON.stringify(capabilities, null, 2)}\n`);
}

async function executeCommand(expectedKind: AdapterCommand["kind"]): Promise<void> {
  const command = await loadCommand();
  if (command.kind !== expectedKind) throw new Error(`command file kind must be ${expectedKind}`);
  const adapter = buildDataAdapterFromEnvironment(command.adapterId, process.env);
  const maximumBytes = Math.min(adapter.capabilities.maximumItemBytes, command.grant.maximumBytes);
  const payload = command.kind === "infer" ? null : await readScopedPayload(command.payloadFile, maximumBytes);
  const commandFingerprint = fingerprint(command, payload ? sha256Hex(payload) : null);
  const root = validateStorageRoot(resolve(required("CANON_SYNC_ROOT")), "Canon sync storage");
  const idempotencyKey = command.kind === "write" ? command.request.idempotencyKey
    : command.kind === "infer" ? command.request.idempotencyKey : command.input.idempotencyKey;
  const idempotencyPath = withinStorageRoot(
    root,
    "action-idempotency",
    command.adapterId,
    `${sha256Hex(utf8(idempotencyKey))}.json`
  );
  const lease = await FileProcessLease.acquire(
    root,
    `adapter-action-${command.adapterId}`,
    integerEnvironment("CANON_ACTION_LEASE_TTL_MS", 10 * 60_000, 30_000, 3_600_000)
  );
  try {
    const rawRecord = await readJsonFile(idempotencyPath);
    const record = storedAction(rawRecord);
    if (rawRecord !== null && record === null) throw new Error("stored action idempotency record is invalid");
    if (record) {
      if (record.fingerprint !== commandFingerprint) throw new Error("idempotency key was already used for a different action payload");
      if (!("result" in record)) {
        process.exitCode = 2;
        process.stdout.write(`${JSON.stringify({
          replayed: true,
          blocked: true,
          state: record.state ?? "UNKNOWN",
          error: record.error ?? "The prior action did not produce a conclusive receipt; reconcile provider state before using a new idempotency key."
        }, null, 2)}\n`);
        return;
      }
      const receipt = receiptFromResult(record.result);
      if (receipt) {
        await durableAtomicJson(withinStorageRoot(root, "action-receipts", command.adapterId, `${receipt.receiptId}.json`), record.result);
        if (receipt.status !== "SUCCEEDED") process.exitCode = 2;
      }
      process.stdout.write(`${JSON.stringify({ replayed: true, result: record.result }, null, 2)}\n`);
      return;
    }

    const idempotencyKeyHash = sha256Hex(utf8(idempotencyKey));
    const startedAt = new Date().toISOString();
    await durableAtomicJson(idempotencyPath, {
      schemaVersion: "aoc.canon.adapter-action/v1",
      state: "STARTED",
      fingerprint: commandFingerprint,
      idempotencyKeyHash,
      startedAt
    });

    let result: unknown;
    try {
      if (command.kind === "write") {
        result = await adapter.write({ ...command.request, metadata: command.request.metadata as JsonObject, bytes: payload as Uint8Array }, command.grant);
      } else if (command.kind === "infer") {
        if (!isAIDataAdapter(adapter)) throw new Error(`${command.adapterId} does not support inference`);
        result = await adapter.infer(command.request, command.grant);
      } else {
        if (!(adapter instanceof CloudKitDataAdapter)) throw new Error("phone instructions require the CloudKit adapter");
        result = await adapter.writePhoneInstruction({ ...command.input, bytes: payload as Uint8Array }, command.grant);
      }
    } catch (error) {
      const failure = safeStoredMessage(error);
      await durableAtomicJson(idempotencyPath, {
        schemaVersion: "aoc.canon.adapter-action/v1",
        state: "FAILED_UNCERTAIN",
        fingerprint: commandFingerprint,
        idempotencyKeyHash,
        startedAt,
        completedAt: new Date().toISOString(),
        error: failure
      });
      await durableAtomicJson(withinStorageRoot(root, "action-failures", command.adapterId, `failure-${randomUUID()}.json`), {
        commandKind: command.kind,
        adapterId: command.adapterId,
        fingerprint: commandFingerprint,
        occurredAt: new Date().toISOString(),
        error: failure
      });
      throw error;
    }

    const stored = {
      schemaVersion: "aoc.canon.adapter-action/v1",
      state: "COMPLETED",
      fingerprint: commandFingerprint,
      idempotencyKeyHash,
      startedAt,
      completedAt: new Date().toISOString(),
      result
    };
    await durableAtomicJson(idempotencyPath, stored);
    const receipt = receiptFromResult(result);
    if (receipt) {
      await durableAtomicJson(withinStorageRoot(root, "action-receipts", command.adapterId, `${receipt.receiptId}.json`), result);
      if (receipt.status !== "SUCCEEDED") process.exitCode = 2;
    }
    process.stdout.write(`${JSON.stringify({ replayed: false, result }, null, 2)}\n`);
  } finally {
    await lease.release();
  }
}

async function main(): Promise<void> {
  const operation = process.argv[2];
  if (operation === "health") return runHealth();
  if (operation === "capabilities") return runCapabilities();
  if (operation === "write" || operation === "infer" || operation === "phone-instruction") return executeCommand(operation);
  throw new Error("usage: canon-adapters.ts <health|capabilities|write|infer|phone-instruction> [--file command.json]");
}

await main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ error: safeStoredMessage(error) })}\n`);
  process.exitCode = 1;
});

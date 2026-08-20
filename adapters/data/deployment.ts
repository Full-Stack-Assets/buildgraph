import { isAbsolute, parse, resolve } from "node:path";
import type { DataAdapter } from "./core.js";
import type { ActionPolicy } from "./authorization.js";
import { CloudKitDataAdapter } from "./providers/cloudkit.js";
import { CopilotDataAdapter } from "./providers/copilot.js";
import { GeminiDataAdapter } from "./providers/gemini.js";
import { GrokDataAdapter } from "./providers/grok.js";

export type DeploymentEnvironment = Record<string, string | undefined>;
export type ServerAdapterId = "grok" | "gemini" | "copilot" | "icloud";

const supportedAdapterIds: readonly ServerAdapterId[] = ["grok", "gemini", "copilot", "icloud"];

function required(env: DeploymentEnvironment, name: string): string {
  const value = env[name];
  if (!value?.trim()) throw new Error(`missing required environment variable ${name}`);
  return value;
}

function booleanValue(env: DeploymentEnvironment, name: string): boolean {
  const value = env[name]?.trim().toLowerCase();
  if (!value || value === "0" || value === "false" || value === "no") return false;
  if (value === "1" || value === "true" || value === "yes") return true;
  throw new Error(`${name} must be true or false`);
}

function commaList(value: string | undefined): string[] | undefined {
  const values = value?.split(",").map((entry) => entry.trim()).filter(Boolean);
  return values && values.length > 0 ? values : undefined;
}

function optionalInteger(
  env: DeploymentEnvironment,
  name: string,
  minimum: number,
  maximum: number
): number | undefined {
  const raw = env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function scopedDirectory(value: string | undefined, name: string): string | undefined {
  if (!value?.trim()) return undefined;
  if (!isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  const normalized = resolve(value);
  if (normalized === parse(normalized).root) throw new Error(`${name} cannot be a filesystem root`);
  return normalized;
}

function actionPolicy(env: DeploymentEnvironment): ActionPolicy {
  return {
    writesEnabled: booleanValue(env, "CANON_ENABLE_WRITES"),
    inferenceEnabled: booleanValue(env, "CANON_ENABLE_INFERENCE"),
    requireApprovalFor: [
      "update",
      ...(booleanValue(env, "CANON_REQUIRE_INFERENCE_APPROVAL") ? (["inference"] as const) : [])
    ]
  };
}

export function selectedAdapterIds(env: DeploymentEnvironment): ServerAdapterId[] {
  const raw = required(env, "CANON_SYNC_ADAPTERS");
  const selected = new Set(raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean));
  const supported = new Set<string>(supportedAdapterIds);
  for (const name of selected) {
    if (!supported.has(name)) throw new Error(`unsupported server adapter ${name}`);
  }
  if (selected.size === 0) throw new Error("CANON_SYNC_ADAPTERS selected no adapters");
  return [...selected] as ServerAdapterId[];
}

export function buildDataAdapterFromEnvironment(adapterId: ServerAdapterId, env: DeploymentEnvironment): DataAdapter {
  const policy = actionPolicy(env);
  if (adapterId === "grok") {
    return new GrokDataAdapter({
      apiKey: required(env, "XAI_API_KEY"),
      managementApiKey: env.XAI_MANAGEMENT_API_KEY,
      collectionIds: commaList(env.XAI_COLLECTION_IDS),
      model: env.XAI_MODEL,
      maximumItemBytes: optionalInteger(env, "XAI_MAX_ITEM_BYTES", 1, 64 * 1024 * 1024),
      collectionPollIntervalMs: optionalInteger(env, "XAI_COLLECTION_POLL_MS", 10, 60_000),
      collectionTimeoutMs: optionalInteger(env, "XAI_COLLECTION_TIMEOUT_MS", 1_000, 3_600_000),
      actionPolicy: policy
    });
  }
  if (adapterId === "gemini") {
    return new GeminiDataAdapter({
      apiKey: required(env, "GEMINI_API_KEY"),
      fileSearchStoreNames: commaList(env.GEMINI_FILE_SEARCH_STORES),
      model: env.GEMINI_MODEL,
      maximumItemBytes: optionalInteger(env, "GEMINI_MAX_ITEM_BYTES", 1, 64 * 1024 * 1024),
      operationPollIntervalMs: optionalInteger(env, "GEMINI_OPERATION_POLL_MS", 10, 60_000),
      operationTimeoutMs: optionalInteger(env, "GEMINI_OPERATION_TIMEOUT_MS", 1_000, 3_600_000),
      actionPolicy: policy
    });
  }
  if (adapterId === "copilot") {
    return new CopilotDataAdapter({
      workingDirectory: scopedDirectory(env.COPILOT_WORKING_DIRECTORY, "COPILOT_WORKING_DIRECTORY"),
      model: env.COPILOT_MODEL,
      maximumEventBytes: optionalInteger(env, "COPILOT_MAX_EVENT_BYTES", 1, 64 * 1024 * 1024),
      responseTimeoutMs: optionalInteger(env, "COPILOT_RESPONSE_TIMEOUT_MS", 1_000, 3_600_000),
      actionPolicy: policy
    });
  }
  if (adapterId === "icloud") {
    const database = env.CLOUDKIT_DATABASE ?? "private";
    if (database !== "private" && database !== "shared" && database !== "public") throw new Error("CLOUDKIT_DATABASE is invalid");
    if (database !== "private") {
      throw new Error("Canon CloudKit custom-zone sync currently requires CLOUDKIT_DATABASE=private");
    }
    const environment = env.CLOUDKIT_ENVIRONMENT ?? "development";
    if (environment !== "development" && environment !== "production") throw new Error("CLOUDKIT_ENVIRONMENT is invalid");
    return new CloudKitDataAdapter({
      containerIdentifier: required(env, "CLOUDKIT_CONTAINER_ID"),
      environment,
      database,
      apiToken: required(env, "CLOUDKIT_API_TOKEN"),
      webAuthToken: env.CLOUDKIT_WEB_AUTH_TOKEN,
      zoneName: env.CLOUDKIT_ZONE_NAME ?? "CanonSyncZone",
      recordTypes: commaList(env.CLOUDKIT_RECORD_TYPES),
      assetHostAllowlist: commaList(env.CLOUDKIT_ASSET_HOST_ALLOWLIST),
      maximumAssetBytes: optionalInteger(env, "CLOUDKIT_MAX_ASSET_BYTES", 1, 15 * 1024 * 1024),
      actionPolicy: policy
    });
  }
  throw new Error(`unsupported server adapter ${adapterId satisfies never}`);
}

export function buildDataAdaptersFromEnvironment(env: DeploymentEnvironment): DataAdapter[] {
  return selectedAdapterIds(env).map((adapterId) => buildDataAdapterFromEnvironment(adapterId, env));
}

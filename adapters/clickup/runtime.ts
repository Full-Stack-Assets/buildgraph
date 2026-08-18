import { readFile } from "node:fs/promises";
import { ClickUpClient } from "./client.js";
import { JsonFileIdempotencyStore } from "./idempotency.js";
import type { IdempotencyStore } from "./idempotency.js";
import {
  ClickUpMissionControl,
  MISSION_CONTROL_LANES
} from "./mission-control.js";
import type { MissionControlConfig, MissionControlLane } from "./mission-control.js";
import { BoundedAsyncQueue } from "./queue.js";
import type { ClickUpFetch } from "./types.js";

type RuntimeEnvironment = Record<string, string | undefined>;

export type CreateClickUpMissionControlFromEnvironmentOptions = {
  config: MissionControlConfig;
  env?: RuntimeEnvironment;
  fetchFn?: ClickUpFetch;
  idempotencyStore?: IdempotencyStore;
  queue?: BoundedAsyncQueue;
};

function requireEnvironmentValue(env: RuntimeEnvironment, key: string): string {
  const value = env[key]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${key} is required`);
  }
  return value;
}

function parseIntegerSetting(
  env: RuntimeEnvironment,
  key: string,
  defaultValue: number,
  minimum: number
): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") {
    return defaultValue;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${key} must be an integer greater than or equal to ${minimum}`);
  }
  return parsed;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireStringProperty(object: Record<string, unknown>, key: string, label: string): string {
  const value = object[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

export async function loadMissionControlConfig(path: string): Promise<MissionControlConfig> {
  if (path.trim() === "") {
    throw new Error("Mission Control config path is required");
  }

  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  const root = requireObject(parsed, "Mission Control config");
  const workspaceId = requireStringProperty(root, "workspaceId", "Mission Control workspaceId");
  const rawLists = requireObject(root.lists, "Mission Control lists");
  const lists = {} as Record<MissionControlLane, string>;

  for (const lane of MISSION_CONTROL_LANES) {
    lists[lane] = requireStringProperty(rawLists, lane, `Mission Control list ${lane}`);
  }

  return { workspaceId, lists };
}

export function createClickUpMissionControlFromEnvironment(
  options: CreateClickUpMissionControlFromEnvironmentOptions
): ClickUpMissionControl {
  const env = options.env ?? process.env;
  const token = requireEnvironmentValue(env, "CLICKUP_API_TOKEN");
  const workspaceId = requireEnvironmentValue(env, "CLICKUP_WORKSPACE_ID");
  if (workspaceId !== options.config.workspaceId) {
    throw new Error(
      `CLICKUP_WORKSPACE_ID ${workspaceId} does not match Mission Control config ${options.config.workspaceId}`
    );
  }

  const idempotencyPath = env.BUILDGRAPH_CLICKUP_IDEMPOTENCY_PATH?.trim()
    || ".runtime/clickup-idempotency.json";
  const concurrency = parseIntegerSetting(env, "BUILDGRAPH_CLICKUP_CONCURRENCY", 2, 1);
  const maxPending = parseIntegerSetting(env, "BUILDGRAPH_CLICKUP_MAX_PENDING", 100, 0);

  const clientOptions: ConstructorParameters<typeof ClickUpClient>[0] = { token };
  if (options.fetchFn !== undefined) clientOptions.fetchFn = options.fetchFn;
  if (env.CLICKUP_API_BASE_URL?.trim()) clientOptions.baseUrl = env.CLICKUP_API_BASE_URL.trim();

  return new ClickUpMissionControl({
    client: new ClickUpClient(clientOptions),
    config: options.config,
    idempotencyStore: options.idempotencyStore ?? new JsonFileIdempotencyStore(idempotencyPath),
    queue: options.queue ?? new BoundedAsyncQueue({ concurrency, maxPending })
  });
}

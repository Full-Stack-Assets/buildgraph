import { pathToFileURL } from "node:url";
import {
  createClickUpMissionControlFromEnvironment,
  loadMissionControlConfig
} from "../adapters/clickup/runtime.js";
import type { MissionControlConnectionVerification } from "../adapters/clickup/mission-control.js";
import type { ClickUpFetch } from "../adapters/clickup/types.js";

export type ClickUpVerificationOptions = {
  configPath: string;
  env?: Record<string, string | undefined>;
  fetchFn?: ClickUpFetch;
};

export async function runClickUpVerification(
  options: ClickUpVerificationOptions
): Promise<MissionControlConnectionVerification> {
  const config = await loadMissionControlConfig(options.configPath);
  const control = createClickUpMissionControlFromEnvironment({
    config,
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn })
  });

  return await control.verifyConnection();
}

async function main(): Promise<void> {
  const configPath = process.argv[2] ?? "config/clickup-mission-control.json";
  const result = await runClickUpVerification({ configPath });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "ClickUp verification failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

import { resolve } from "node:path";
import { buildDataAdaptersFromEnvironment } from "../adapters/data/deployment.js";
import { appendDurableJsonLine, FileProcessLease, safeStoredMessage } from "../adapters/data/file-store.js";
import {
  SupabaseCanonSink,
  SupabaseCheckpointStore,
  SupabaseDeadLetterStore,
  SupabaseLease,
  SupabaseRunStore,
  SupabaseClient
} from "../adapters/data/supabase.js";
import { ContinuousSyncEngine } from "../adapters/data/sync-engine.js";
import { FileCheckpointStore, FileDeadLetterStore, FileSystemCanonSink } from "../adapters/data/storage.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`missing required environment variable ${name}`);
  return value;
}

const backend = process.env.CANON_STORAGE_BACKEND?.trim() ?? "file";
const root = backend === "file" ? resolve(required("CANON_SYNC_ROOT")) : null;
const receiptsPath = root ? resolve(root, "run-receipts.jsonl") : null;

function integer(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? String(fallback));
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

async function record(value: unknown): Promise<void> {
  if (backend === "supabase") {
    await new SupabaseRunStore().putSync(value);
    return;
  }
  await appendDurableJsonLine(receiptsPath as string, value);
}

async function main(): Promise<void> {
  if (backend !== "file" && backend !== "supabase") throw new Error("CANON_STORAGE_BACKEND must be file or supabase");
  const lease = backend === "supabase"
    ? await SupabaseLease.acquire("continuous-sync", integer("CANON_SYNC_LEASE_TTL_MS", 10 * 60_000, 30_000, 3_600_000))
    : await FileProcessLease.acquire(root as string, "continuous-sync", integer("CANON_SYNC_LEASE_TTL_MS", 10 * 60_000, 30_000, 3_600_000));
  try {
    const supabase = backend === "supabase" ? new SupabaseClient() : null;
    const engine = new ContinuousSyncEngine({
      adapters: buildDataAdaptersFromEnvironment(process.env),
      sink: supabase
        ? new SupabaseCanonSink(supabase)
        : new FileSystemCanonSink(root as string, integer("CANON_SINK_MAX_ITEM_BYTES", 64 * 1024 * 1024, 1, 64 * 1024 * 1024)),
      checkpoints: supabase ? new SupabaseCheckpointStore(supabase) : new FileCheckpointStore(root as string),
      deadLetters: supabase ? new SupabaseDeadLetterStore(supabase) : new FileDeadLetterStore(root as string),
      config: {
        intervalMs: integer("CANON_SYNC_INTERVAL_MS", 300_000, 1_000, 86_400_000),
        maximumPagesPerRun: integer("CANON_SYNC_MAX_PAGES", 100, 1, 10_000)
      }
    });
    if (process.argv.includes("--once")) {
      const receipts = await engine.syncOnce();
      await record(receipts);
      process.stdout.write(`${JSON.stringify(receipts, null, 2)}\n`);
      if (receipts.some((receipt) => receipt.status !== "SUCCEEDED")) process.exitCode = 2;
      return;
    }
    const controller = new AbortController();
    process.once("SIGINT", () => controller.abort(new Error("SIGINT")));
    process.once("SIGTERM", () => controller.abort(new Error("SIGTERM")));
    await engine.run(controller.signal, record);
  } finally {
    await lease.release();
  }
}

await main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ error: safeStoredMessage(error) })}\n`);
  process.exitCode = 1;
});

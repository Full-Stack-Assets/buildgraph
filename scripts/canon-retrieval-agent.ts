import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AutonomousRetrievalJob } from "../adapters/data/retrieval-agent.js";
import { AutonomousRetrievalAgent, FileInferenceEvidenceStore, FileRetrievalStateStore } from "../adapters/data/retrieval-agent.js";
import { buildDataAdaptersFromEnvironment } from "../adapters/data/deployment.js";
import { appendDurableJsonLine, FileProcessLease, safeStoredMessage } from "../adapters/data/file-store.js";
import {
  SupabaseInferenceEvidenceStore,
  SupabaseLease,
  SupabaseRetrievalStateStore,
  SupabaseRunStore,
  SupabaseClient
} from "../adapters/data/supabase.js";
import { registerBuildGraphFormats } from "./ajv-formats.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`missing required environment variable ${name}`);
  return value;
}

async function loadJobs(path: string, maximumBytes: number): Promise<AutonomousRetrievalJob[]> {
  const details = await lstat(path);
  if (details.isSymbolicLink() || !details.isFile()) throw new Error("retrieval jobs file must be a regular non-symlink file");
  if (details.size > maximumBytes) throw new Error("retrieval jobs file exceeds CANON_RETRIEVAL_JOBS_MAX_BYTES");
  const bytes = await readFile(path);
  if (bytes.byteLength > maximumBytes) throw new Error("retrieval jobs file exceeds CANON_RETRIEVAL_JOBS_MAX_BYTES");
  const value = JSON.parse(bytes.toString("utf8")) as unknown;
  const schemaRoot = resolve(import.meta.dirname, "..", "schemas");
  const grantSchema = JSON.parse(await readFile(resolve(schemaRoot, "data-action-grant.schema.json"), "utf8")) as object;
  const jobsSchema = JSON.parse(await readFile(resolve(schemaRoot, "autonomous-retrieval-jobs.schema.json"), "utf8")) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  registerBuildGraphFormats(ajv);
  ajv.addSchema(grantSchema);
  const validate = ajv.compile(jobsSchema);
  if (!validate(value)) throw new Error(`invalid retrieval jobs file: ${ajv.errorsText(validate.errors)}`);
  return (value as { jobs: AutonomousRetrievalJob[] }).jobs;
}

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveSleep, reject) => {
    const timeout = setTimeout(resolveSleep, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(signal.reason ?? new Error("retrieval agent cancelled"));
    }, { once: true });
  });
}

const backend = process.env.CANON_STORAGE_BACKEND?.trim() ?? "file";
const root = backend === "file" ? resolve(required("CANON_SYNC_ROOT")) : null;
const jobsPath = resolve(required("CANON_RETRIEVAL_JOBS_FILE"));
const receiptsPath = root ? resolve(root, "retrieval-run-receipts.jsonl") : null;

function integer(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? String(fallback));
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

const maximumJobsBytes = integer("CANON_RETRIEVAL_JOBS_MAX_BYTES", 8 * 1024 * 1024, 1, 64 * 1024 * 1024);

async function run(agent: AutonomousRetrievalAgent): Promise<boolean> {
  const receipts = await agent.runDue(await loadJobs(jobsPath, maximumJobsBytes));
  if (backend === "supabase") await new SupabaseRunStore().putRetrieval(receipts);
  else await appendDurableJsonLine(receiptsPath as string, receipts);
  process.stdout.write(`${JSON.stringify(receipts, null, 2)}\n`);
  return receipts.every((receipt) => receipt.status !== "FAILED");
}

async function main(): Promise<void> {
  if (backend !== "file" && backend !== "supabase") throw new Error("CANON_STORAGE_BACKEND must be file or supabase");
  const lease = backend === "supabase"
    ? await SupabaseLease.acquire("autonomous-retrieval", integer("CANON_RETRIEVAL_LEASE_TTL_MS", 10 * 60_000, 30_000, 3_600_000))
    : await FileProcessLease.acquire(root as string, "autonomous-retrieval", integer("CANON_RETRIEVAL_LEASE_TTL_MS", 10 * 60_000, 30_000, 3_600_000));
  try {
    const supabase = backend === "supabase" ? new SupabaseClient() : null;
    const agent = new AutonomousRetrievalAgent({
      adapters: buildDataAdaptersFromEnvironment(process.env),
      stateStore: supabase ? new SupabaseRetrievalStateStore(supabase) : new FileRetrievalStateStore(root as string),
      evidenceStore: supabase
        ? new SupabaseInferenceEvidenceStore(supabase, integer("CANON_INFERENCE_EVIDENCE_MAX_BYTES", 8 * 1024 * 1024, 1, 64 * 1024 * 1024))
        : new FileInferenceEvidenceStore(root as string, integer("CANON_INFERENCE_EVIDENCE_MAX_BYTES", 8 * 1024 * 1024, 1, 64 * 1024 * 1024))
    });
    if (process.argv.includes("--once")) {
      if (!(await run(agent))) process.exitCode = 2;
      return;
    }
    const controller = new AbortController();
    process.once("SIGINT", () => controller.abort(new Error("SIGINT")));
    process.once("SIGTERM", () => controller.abort(new Error("SIGTERM")));
    const pollMs = integer("CANON_RETRIEVAL_POLL_MS", 60_000, 10_000, 86_400_000);
    while (!controller.signal.aborted) {
      try {
        await run(agent);
      } catch (error) {
        const failure = { status: "RUNNER_FAILED", occurredAt: new Date().toISOString(), error: safeStoredMessage(error) };
        if (backend === "supabase") await new SupabaseRunStore().putRetrieval(failure);
        else await appendDurableJsonLine(receiptsPath as string, failure);
        process.stderr.write(`${JSON.stringify({ error: safeStoredMessage(error) })}\n`);
      }
      try { await sleep(pollMs, controller.signal); } catch { break; }
    }
  } finally {
    await lease.release();
  }
}

await main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ error: safeStoredMessage(error) })}\n`);
  process.exitCode = 1;
});

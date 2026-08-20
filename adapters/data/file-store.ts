import { randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, link, mkdir, open, readFile, rename, stat, unlink, utimes } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";

export function validateStorageRoot(root: string, purpose = "storage"): string {
  if (!isAbsolute(root)) throw new Error(`${purpose} root must be absolute`);
  const normalized = resolve(root);
  if (normalized === parse(normalized).root) throw new Error(`${purpose} root cannot be a filesystem root`);
  return normalized;
}

export function withinStorageRoot(root: string, ...parts: string[]): string {
  const target = resolve(root, ...parts);
  const relation = relative(root, target);
  if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error("resolved storage path escaped the configured root");
  }
  return target;
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

async function syncDirectory(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch (error) {
    if (!(error instanceof Error && "code" in error && (error.code === "EINVAL" || error.code === "ENOTSUP"))) throw error;
  } finally {
    await handle?.close();
  }
}

export async function readJsonFile(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

export async function durableAtomicJson(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await ensurePrivateDirectory(directory);
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close();
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function durableWriteContentAddressed(path: string, bytes: Uint8Array): Promise<void> {
  if (await pathExists(path)) {
    const existing = await readFile(path);
    if (existing.byteLength !== bytes.byteLength || !timingSafeEqual(existing, bytes)) {
      throw new Error("content-addressed object already exists with different bytes");
    }
    return;
  }
  const directory = dirname(path);
  await ensurePrivateDirectory(directory);
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, path);
      await syncDirectory(directory);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      const existing = await readFile(path);
      if (existing.byteLength !== bytes.byteLength || !timingSafeEqual(existing, bytes)) {
        throw new Error("content-addressed object race produced different bytes");
      }
    }
  } finally {
    await handle?.close();
    await unlink(temporary).catch(() => undefined);
  }
}

export async function appendDurableJsonLine(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await ensurePrivateDirectory(directory);
  const handle = await open(path, "a", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function safeStoredMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value
    .slice(0, 2048)
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key|token|secret)["'\s:=]+[A-Za-z0-9._~+/-]{8,}/gi, "$1=[redacted]");
}

export class FileProcessLease {
  readonly #path: string;
  readonly #ownerId: string;
  readonly #heartbeat: ReturnType<typeof setInterval>;
  #released = false;

  private constructor(path: string, ownerId: string, heartbeat: ReturnType<typeof setInterval>) {
    this.#path = path;
    this.#ownerId = ownerId;
    this.#heartbeat = heartbeat;
  }

  static async acquire(root: string, name: string, ttlMs = 10 * 60_000): Promise<FileProcessLease> {
    const normalizedRoot = validateStorageRoot(root, "process lease");
    if (!/^[A-Za-z0-9._-]{3,128}$/.test(name)) throw new Error("process lease name is invalid");
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 30_000) throw new Error("process lease TTL must be at least 30000ms");
    const directory = withinStorageRoot(normalizedRoot, "run-locks");
    await ensurePrivateDirectory(directory);
    const path = withinStorageRoot(normalizedRoot, "run-locks", `${name}.lock`);
    const ownerId = randomUUID();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const handle = await open(path, "wx", 0o600);
        try {
          await handle.writeFile(`${JSON.stringify({ ownerId, pid: process.pid, hostname: hostname(), acquiredAt: new Date().toISOString(), ttlMs })}\n`, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        const heartbeat = setInterval(() => {
          const now = new Date();
          void utimes(path, now, now).catch(() => undefined);
        }, Math.max(10_000, Math.floor(ttlMs / 3)));
        heartbeat.unref();
        return new FileProcessLease(path, ownerId, heartbeat);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        const details = await stat(path).catch(() => null);
        if (!details) continue;
        const existing = await readJsonFile(path).catch(() => null);
        const record = existing !== null && typeof existing === "object" && !Array.isArray(existing)
          ? existing as { pid?: unknown; hostname?: unknown }
          : {};
        let sameHostProcessAlive = false;
        if (record.hostname === hostname() && Number.isSafeInteger(record.pid)) {
          try {
            process.kill(record.pid as number, 0);
            sameHostProcessAlive = true;
          } catch (processError) {
            if (!(processError instanceof Error && "code" in processError && processError.code === "ESRCH")) {
              sameHostProcessAlive = true;
            }
          }
        }
        if (sameHostProcessAlive || Date.now() - details.mtimeMs <= ttlMs) {
          throw new Error(`another ${name} process holds the active lease`);
        }
        const stale = `${path}.stale-${randomUUID()}`;
        try {
          await rename(path, stale);
          await unlink(stale).catch(() => undefined);
        } catch (renameError) {
          if (!(renameError instanceof Error && "code" in renameError && renameError.code === "ENOENT")) throw renameError;
        }
      }
    }
    throw new Error(`could not acquire ${name} process lease`);
  }

  async release(): Promise<void> {
    if (this.#released) return;
    this.#released = true;
    clearInterval(this.#heartbeat);
    const value = await readJsonFile(this.#path);
    if (value !== null && typeof value === "object" && !Array.isArray(value)
      && (value as { ownerId?: unknown }).ownerId === this.#ownerId) {
      await unlink(this.#path).catch((error: unknown) => {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      });
    }
  }
}

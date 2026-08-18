import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type PendingIdempotencyRecord = {
  state: "pending";
  startedAt: string;
};

export type CompletedIdempotencyRecord = {
  state: "completed";
  completedAt: string;
  result: unknown;
};

export type IdempotencyRecord = PendingIdempotencyRecord | CompletedIdempotencyRecord;

export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | undefined>;
  begin(key: string): Promise<void>;
  complete(key: string, result: unknown): Promise<void>;
  release(key: string): Promise<void>;
}

type Clock = () => string;

type SerializedRecords = Record<string, IdempotencyRecord>;

function defaultClock(): string {
  return new Date().toISOString();
}

function assertKey(key: string): void {
  if (key.trim() === "") {
    throw new Error("idempotency key is required");
  }
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  readonly #records = new Map<string, IdempotencyRecord>();
  readonly #clock: Clock;

  constructor(clock: Clock = defaultClock) {
    this.#clock = clock;
  }

  async get(key: string): Promise<IdempotencyRecord | undefined> {
    assertKey(key);
    return this.#records.get(key);
  }

  async begin(key: string): Promise<void> {
    assertKey(key);
    if (this.#records.has(key)) {
      throw new Error(`idempotency key already exists: ${key}`);
    }

    this.#records.set(key, {
      state: "pending",
      startedAt: this.#clock()
    });
  }

  async complete(key: string, result: unknown): Promise<void> {
    assertKey(key);
    const record = this.#records.get(key);
    if (record?.state !== "pending") {
      throw new Error(`idempotency key is not pending: ${key}`);
    }

    this.#records.set(key, {
      state: "completed",
      completedAt: this.#clock(),
      result
    });
  }

  async release(key: string): Promise<void> {
    assertKey(key);
    if (this.#records.get(key)?.state === "pending") {
      this.#records.delete(key);
    }
  }
}

export class JsonFileIdempotencyStore implements IdempotencyStore {
  readonly #path: string;
  readonly #clock: Clock;
  #mutationLock: Promise<void> = Promise.resolve();

  constructor(path: string, clock: Clock = defaultClock) {
    if (path.trim() === "") {
      throw new Error("idempotency store path is required");
    }
    this.#path = path;
    this.#clock = clock;
  }

  async get(key: string): Promise<IdempotencyRecord | undefined> {
    assertKey(key);
    const records = await this.#readRecords();
    return records[key];
  }

  async begin(key: string): Promise<void> {
    assertKey(key);
    await this.#withMutation(async () => {
      const records = await this.#readRecords();
      if (records[key] !== undefined) {
        throw new Error(`idempotency key already exists: ${key}`);
      }
      records[key] = {
        state: "pending",
        startedAt: this.#clock()
      };
      await this.#writeRecords(records);
    });
  }

  async complete(key: string, result: unknown): Promise<void> {
    assertKey(key);
    await this.#withMutation(async () => {
      const records = await this.#readRecords();
      if (records[key]?.state !== "pending") {
        throw new Error(`idempotency key is not pending: ${key}`);
      }
      records[key] = {
        state: "completed",
        completedAt: this.#clock(),
        result
      };
      await this.#writeRecords(records);
    });
  }

  async release(key: string): Promise<void> {
    assertKey(key);
    await this.#withMutation(async () => {
      const records = await this.#readRecords();
      if (records[key]?.state === "pending") {
        delete records[key];
        await this.#writeRecords(records);
      }
    });
  }

  async #readRecords(): Promise<SerializedRecords> {
    try {
      const content = await readFile(this.#path, "utf8");
      return JSON.parse(content) as SerializedRecords;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }
      throw error;
    }
  }

  async #writeRecords(records: SerializedRecords): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const temporaryPath = `${this.#path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.#path);
  }

  async #withMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const previous = this.#mutationLock;
    let unlock: () => void = () => undefined;
    this.#mutationLock = new Promise<void>((resolve) => {
      unlock = resolve;
    });

    await previous;
    try {
      return await mutation();
    } finally {
      unlock();
    }
  }
}

import type {
  ClickUpClientOptions,
  ClickUpHttpMethod,
  ClickUpRateLimitSnapshot
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.clickup.com/api/v2";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_BASE_MS = 250;
const MAX_BACKOFF_MS = 30_000;

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseIntegerHeader(value: string | null): number | null {
  if (value === null || value.trim() === "") {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseResetAtMs(value: string | null): number | null {
  const parsed = parseIntegerHeader(value);
  if (parsed === null) {
    return null;
  }

  return parsed < 1_000_000_000_000 ? parsed * 1000 : parsed;
}

function readRateLimit(headers: Headers): ClickUpRateLimitSnapshot {
  return {
    limit: parseIntegerHeader(headers.get("x-ratelimit-limit")),
    remaining: parseIntegerHeader(headers.get("x-ratelimit-remaining")),
    resetAtMs: parseResetAtMs(headers.get("x-ratelimit-reset"))
  };
}

function isRetryableRequest(method: ClickUpHttpMethod, status: number): boolean {
  if (status === 429) {
    return true;
  }
  if (status < 500) {
    return false;
  }
  return method === "GET" || method === "PUT";
}

export class ClickUpHttpError extends Error {
  readonly status: number;
  readonly responseBody: string;
  readonly retryable: boolean;

  constructor(status: number, responseBody: string, retryable = false) {
    super(`ClickUp API request failed with status ${status}`);
    this.name = "ClickUpHttpError";
    this.status = status;
    this.responseBody = responseBody;
    this.retryable = retryable;
  }
}

export class ClickUpClient {
  readonly #token: string;
  readonly #baseUrl: string;
  readonly #fetchFn: NonNullable<ClickUpClientOptions["fetchFn"]>;
  readonly #sleep: NonNullable<ClickUpClientOptions["sleep"]>;
  readonly #now: NonNullable<ClickUpClientOptions["now"]>;
  readonly #maxRetries: number;
  readonly #backoffBaseMs: number;

  rateLimitSnapshot: ClickUpRateLimitSnapshot | null = null;

  constructor(options: ClickUpClientOptions) {
    if (options.token.trim() === "") {
      throw new Error("ClickUp API token is required");
    }

    this.#token = options.token;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.#fetchFn = options.fetchFn ?? fetch;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#now = options.now ?? Date.now;
    this.#maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.#backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  }

  async request<T = unknown>(method: ClickUpHttpMethod, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      const headers: Record<string, string> = {
        Authorization: this.#token,
        Accept: "application/json"
      };

      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }

      const response = await this.#fetchFn(`${this.#baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });

      this.rateLimitSnapshot = readRateLimit(response.headers);

      if (response.ok) {
        if (response.status === 204) {
          return undefined as T;
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          return await response.json() as T;
        }

        return await response.text() as T;
      }

      const responseBody = await response.text();
      const retryable = isRetryableRequest(method, response.status);
      const error = new ClickUpHttpError(response.status, responseBody, retryable);

      if (!retryable || attempt >= this.#maxRetries) {
        throw error;
      }

      const retryDelay = response.status === 429 && this.rateLimitSnapshot.resetAtMs !== null
        ? Math.max(0, this.rateLimitSnapshot.resetAtMs - this.#now())
        : Math.min(MAX_BACKOFF_MS, this.#backoffBaseMs * (2 ** attempt));

      await this.#sleep(retryDelay);
    }
  }
}

export type {
  ClickUpClientOptions,
  ClickUpHttpMethod,
  ClickUpRateLimitSnapshot
} from "./types.js";

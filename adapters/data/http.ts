export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type Sleep = (milliseconds: number) => Promise<void>;

export class AdapterHttpError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  readonly requestId: string | null;
  readonly responseSummary: string;

  constructor(input: {
    message: string;
    status: number | null;
    retryable: boolean;
    requestId?: string | null;
    responseSummary?: string;
  }) {
    super(input.message);
    this.name = "AdapterHttpError";
    this.status = input.status;
    this.retryable = input.retryable;
    this.requestId = input.requestId ?? null;
    this.responseSummary = input.responseSummary ?? "";
  }
}

export function classifyAdapterHealthError(error: unknown): "UNAUTHENTICATED" | "UNREACHABLE" {
  return error instanceof AdapterHttpError && (error.status === 401 || error.status === 403)
    ? "UNAUTHENTICATED"
    : "UNREACHABLE";
}

function sanitizeBody(value: string): string {
  return value
    .slice(0, 1024)
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key|token|secret)["'\s:=]+[A-Za-z0-9._~+/-]{8,}/gi, "$1=[redacted]");
}

function assertAllowedUrl(url: URL, allowedHosts: string[]): void {
  if (url.protocol !== "https:") {
    throw new Error("adapter HTTP requests require HTTPS");
  }
  if (url.username || url.password) throw new Error("adapter URLs cannot contain user information");
  if (url.port && url.port !== "443") throw new Error("adapter URLs cannot use non-standard HTTPS ports");
  if (allowedHosts.length === 0 || allowedHosts.some((entry) => !entry.trim() || entry.includes("/") || entry.includes(":"))) {
    throw new Error("adapter host allowlist is invalid");
  }
  const hostname = url.hostname.toLowerCase();
  const allowed = allowedHosts.some((entry) => {
    const normalized = entry.toLowerCase();
    return normalized.startsWith(".") ? hostname.endsWith(normalized) : hostname === normalized;
  });
  if (!allowed) {
    throw new Error("adapter URL host is outside the configured allowlist");
  }
}

function retryAfterMilliseconds(response: Response, attempt: number): number {
  const value = response.headers.get("retry-after");
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
    const when = Date.parse(value);
    if (Number.isFinite(when)) return Math.min(Math.max(0, when - Date.now()), 30_000);
  }
  return Math.min(250 * 2 ** attempt, 5_000);
}

async function readBounded(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new AdapterHttpError({
      message: "adapter response exceeded the configured byte limit",
      status: response.status,
      retryable: false
    });
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new AdapterHttpError({
        message: "adapter response exceeded the configured byte limit",
        status: response.status,
        retryable: false
      });
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export async function adapterRequest(input: {
  url: string | URL;
  init?: RequestInit;
  allowedHosts: string[];
  maximumResponseBytes: number;
  timeoutMs?: number;
  maximumRetries?: number;
  retryMutation?: boolean;
  fetcher?: FetchLike;
  sleep?: Sleep;
}): Promise<{ response: Response; bytes: Uint8Array }> {
  if (!Number.isSafeInteger(input.maximumResponseBytes) || input.maximumResponseBytes < 1 || input.maximumResponseBytes > 128 * 1024 * 1024) {
    throw new Error("adapter maximumResponseBytes must be from 1 through 134217728");
  }
  const timeoutMs = input.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600_000) {
    throw new Error("adapter timeoutMs must be from 100 through 600000");
  }
  const maximumRetries = input.maximumRetries ?? 2;
  if (!Number.isSafeInteger(maximumRetries) || maximumRetries < 0 || maximumRetries > 10) {
    throw new Error("adapter maximumRetries must be from 0 through 10");
  }
  const url = input.url instanceof URL ? input.url : new URL(input.url);
  assertAllowedUrl(url, input.allowedHosts);
  const fetcher = input.fetcher ?? fetch;
  const sleep = input.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const method = (input.init?.method ?? "GET").toUpperCase();
  const retrySafe = method === "GET" || method === "HEAD" || input.retryMutation === true;

  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, { ...input.init, redirect: "manual", signal: controller.signal });
      const bytes = await readBounded(response, input.maximumResponseBytes);
      if (response.ok) return { response, bytes };

      const retryable = response.status === 429 || response.status >= 500;
      if (retrySafe && retryable && attempt < maximumRetries) {
        await sleep(retryAfterMilliseconds(response, attempt));
        continue;
      }
      throw new AdapterHttpError({
        message: `adapter request failed with HTTP ${response.status}`,
        status: response.status,
        retryable,
        requestId: response.headers.get("x-request-id") ?? response.headers.get("x-goog-request-id"),
        responseSummary: sanitizeBody(new TextDecoder().decode(bytes))
      });
    } catch (error) {
      if (error instanceof AdapterHttpError) throw error;
      const retryable = error instanceof TypeError || (error instanceof Error && error.name === "AbortError");
      if (retrySafe && retryable && attempt < maximumRetries) {
        await sleep(Math.min(250 * 2 ** attempt, 5_000));
        continue;
      }
      throw new AdapterHttpError({
        message: retryable ? "adapter request timed out" : "adapter request failed before receiving a response",
        status: null,
        retryable
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function adapterJson<T>(input: Parameters<typeof adapterRequest>[0]): Promise<{ response: Response; value: T }> {
  const result = await adapterRequest(input);
  if (result.bytes.byteLength === 0) return { response: result.response, value: {} as T };
  try {
    return { response: result.response, value: JSON.parse(new TextDecoder().decode(result.bytes)) as T };
  } catch {
    throw new AdapterHttpError({
      message: "adapter response was not valid JSON",
      status: result.response.status,
      retryable: false,
      requestId: result.response.headers.get("x-request-id")
    });
  }
}

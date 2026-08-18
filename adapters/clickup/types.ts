export type ClickUpHttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export type ClickUpFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export type ClickUpSleep = (milliseconds: number) => Promise<void>;

export type ClickUpRateLimitSnapshot = {
  limit: number | null;
  remaining: number | null;
  resetAtMs: number | null;
};

export type ClickUpClientOptions = {
  token: string;
  baseUrl?: string;
  fetchFn?: ClickUpFetch;
  sleep?: ClickUpSleep;
  now?: () => number;
  maxRetries?: number;
  backoffBaseMs?: number;
};

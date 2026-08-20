import { randomUUID } from "node:crypto";
import type { ConnectionState, GatewayResult, Receipt } from "./contracts.js";

type FetchLike = typeof fetch;

export interface GeminiAdapterOptions {
  apiKey?: string;
  model?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

export class GeminiAdapter {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number;

  constructor(options: GeminiAdapterOptions = {}) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? "gemini-2.5-flash";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxOutputTokens = Math.min(options.maxOutputTokens ?? 512, 2048);
  }

  async ask(prompt: string): Promise<GatewayResult<{ text: string }>> {
    if (!this.apiKey) return this.result("AUTH_REQUIRED");
    if (!prompt.trim() || prompt.length > 20_000) return this.result("BLOCKED");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": this.apiKey
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: this.maxOutputTokens }
          }),
          signal: controller.signal
        }
      );

      if (!response.ok) return this.result(classifyStatus(response.status));

      const payload = await response.json() as GeminiResponse;
      const text = payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim();

      return text ? this.result("CONNECTED", { text }) : this.result("NO_RESULTS");
    } catch (error) {
      return this.result(error instanceof Error && error.name === "AbortError" ? "UNREACHABLE" : "DEGRADED");
    } finally {
      clearTimeout(timeout);
    }
  }

  private result<T>(state: ConnectionState, data?: T): GatewayResult<T> {
    const receipt: Receipt = {
      id: randomUUID(),
      source: "gemini",
      operation: "gemini_ask",
      state,
      occurredAt: new Date().toISOString(),
      redactions: ["credential", "prompt"]
    };
    return { state, data, receipt };
  }
}

export function classifyStatus(status: number): ConnectionState {
  if (status === 401 || status === 403) return "AUTH_REQUIRED";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "DEGRADED";
  return "BLOCKED";
}

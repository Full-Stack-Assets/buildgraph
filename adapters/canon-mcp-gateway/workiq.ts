import { randomUUID } from "node:crypto";
import type { ConnectionState, GatewayResult, Operation, Receipt } from "./contracts.js";

export interface WorkIqTransport {
  call(tool: "fetch" | "ask", input: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export interface WorkIqAdapterOptions {
  transport?: WorkIqTransport;
  maxQueryLength?: number;
}

export class WorkIqAdapter {
  private readonly transport?: WorkIqTransport;
  private readonly maxQueryLength: number;

  constructor(options: WorkIqAdapterOptions = {}) {
    this.transport = options.transport;
    this.maxQueryLength = options.maxQueryLength ?? 10_000;
  }

  async fetch(path: string): Promise<GatewayResult<unknown>> {
    if (!this.transport) return this.result("workiq_fetch", "AUTH_REQUIRED");
    if (!isReadPath(path)) return this.result("workiq_fetch", "BLOCKED");
    return this.invoke("workiq_fetch", "fetch", { path });
  }

  async ask(query: string): Promise<GatewayResult<unknown>> {
    if (!this.transport) return this.result("workiq_ask", "AUTH_REQUIRED");
    if (!query.trim() || query.length > this.maxQueryLength) return this.result("workiq_ask", "BLOCKED");
    return this.invoke("workiq_ask", "ask", { query });
  }

  private async invoke(operation: Operation, tool: "fetch" | "ask", input: Readonly<Record<string, unknown>>): Promise<GatewayResult<unknown>> {
    try {
      const data = await this.transport!.call(tool, input);
      return data === undefined || data === null ? this.result(operation, "NO_RESULTS") : this.result(operation, "CONNECTED", data);
    } catch (error) {
      return this.result(operation, classifyWorkIqError(error));
    }
  }

  private result<T>(operation: Operation, state: ConnectionState, data?: T): GatewayResult<T> {
    const receipt: Receipt = {
      id: randomUUID(),
      source: "workiq",
      operation,
      state,
      occurredAt: new Date().toISOString(),
      redactions: ["credential", "query", "m365_content"]
    };
    return { state, data, receipt };
  }
}

export function isReadPath(path: string): boolean {
  const normalized = path.trim().toLowerCase();
  if (!normalized.startsWith("/") || normalized.length > 2_048) return false;
  return !/(^|\/)(create|update|delete|remove|send|post|patch|action)(\/|$)/.test(normalized);
}

export function classifyWorkIqError(error: unknown): ConnectionState {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/401|unauth|token|sign.?in/.test(message)) return "AUTH_REQUIRED";
  if (/403|consent|license|billing|forbidden/.test(message)) return "CONSENT_REQUIRED";
  if (/429|rate.?limit|quota/.test(message)) return "RATE_LIMITED";
  if (/timeout|network|unreachable|offline/.test(message)) return "UNREACHABLE";
  return "DEGRADED";
}

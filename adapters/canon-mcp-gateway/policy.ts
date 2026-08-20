import type { Authority, GatewayRequest, Operation, Source } from "./contracts";

const allowed: Record<Operation, { sources: Source[]; authorities: Authority[] }> = {
  connections_list: { sources: ["gemini","workiq","icloud_drive","photos","contacts","reminders","calendar","iphone_files"], authorities: ["read_metadata"] },
  connections_probe: { sources: ["gemini","workiq","icloud_drive","photos","contacts","reminders","calendar","iphone_files"], authorities: ["read_metadata","read_bounded"] },
  source_list_changes: { sources: ["gemini","workiq","icloud_drive","photos","contacts","reminders","calendar","iphone_files"], authorities: ["read_metadata"] },
  source_read: { sources: ["gemini","workiq","icloud_drive","photos","contacts","reminders","calendar","iphone_files"], authorities: ["read_metadata","read_bounded"] },
  apple_grants_status: { sources: ["icloud_drive","photos","contacts","reminders","calendar","iphone_files"], authorities: ["read_metadata"] },
  gemini_ask: { sources: ["gemini"], authorities: ["read_inference"] },
  workiq_fetch: { sources: ["workiq"], authorities: ["read_bounded"] },
  workiq_ask: { sources: ["workiq"], authorities: ["read_inference"] }
};

export function assertAllowed(request: GatewayRequest): void {
  const rule = allowed[request.operation];
  if (!rule || !rule.sources.includes(request.source) || !rule.authorities.includes(request.authority)) {
    throw new Error("BLOCKED: operation is outside the read-first gateway policy");
  }
  if (request.limit !== undefined && (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100)) {
    throw new Error("BLOCKED: limit exceeds bounded retrieval policy");
  }
}

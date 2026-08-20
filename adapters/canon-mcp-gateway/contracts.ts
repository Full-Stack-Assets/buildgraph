export type Source = "gemini"|"workiq"|"icloud_drive"|"photos"|"contacts"|"reminders"|"calendar"|"iphone_files";
export type Operation = "connections_list"|"connections_probe"|"source_list_changes"|"source_read"|"apple_grants_status"|"gemini_ask"|"workiq_fetch"|"workiq_ask";
export type ConnectionState = "CONNECTED"|"PARTIAL"|"NO_RESULTS"|"AUTH_REQUIRED"|"CONSENT_REQUIRED"|"BLOCKED"|"UNREACHABLE"|"RATE_LIMITED"|"DEGRADED"|"UNAVAILABLE";
export type Authority = "read_metadata"|"read_bounded"|"read_inference";
export interface GatewayRequest { operation: Operation; source: Source; authority: Authority; limit?: number; cursor?: string; }
export interface Receipt { id: string; source: Source; operation: Operation; state: ConnectionState; occurredAt: string; redactions: string[]; }
export interface GatewayResult<T=unknown> { state: ConnectionState; data?: T; receipt: Receipt; nextCursor?: string; }

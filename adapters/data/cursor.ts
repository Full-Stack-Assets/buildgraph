import type { JsonObject } from "./core.js";

const cursorVersion = 1;
const maximumCursorLength = 16_384;

export function encodeCursor(payload: JsonObject): string {
  const encoded = Buffer.from(JSON.stringify({ v: cursorVersion, payload }), "utf8").toString("base64url");
  if (encoded.length > maximumCursorLength) throw new Error("adapter cursor exceeds the maximum encoded length");
  return encoded;
}

export function decodeCursor(cursor: string | null): JsonObject {
  if (cursor === null) return {};
  if (cursor.length === 0 || cursor.length > maximumCursorLength || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new Error("invalid adapter cursor encoding");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
  } catch {
    throw new Error("invalid adapter cursor payload");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid adapter cursor envelope");
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.v !== cursorVersion || envelope.payload === null || typeof envelope.payload !== "object" || Array.isArray(envelope.payload)) {
    throw new Error("unsupported adapter cursor version");
  }
  return envelope.payload as JsonObject;
}

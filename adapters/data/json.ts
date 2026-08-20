import type { JsonObject, JsonValue } from "./core.js";

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function asIsoDate(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.valueOf())) return value.toISOString();
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : null;
}

export function toJsonValue(value: unknown, depth = 0): JsonValue {
  if (depth > 20) return "[depth-limit]";
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item, depth + 1));
  if (value !== null && typeof value === "object") {
    const result: JsonObject = {};
    for (const [key, child] of Object.entries(value)) result[key] = toJsonValue(child, depth + 1);
    return result;
  }
  return String(value);
}

export function toJsonObject(value: unknown): JsonObject {
  const converted = toJsonValue(value);
  return converted !== null && typeof converted === "object" && !Array.isArray(converted) ? converted : { value: converted };
}

export function extractText(value: unknown): string {
  const root = asRecord(value);
  const direct = asString(root.output_text)
    ?? asString(root.outputText)
    ?? asString(root.text)
    ?? asString(root.content)
    ?? asString(asRecord(root.data).content)
    ?? asString(asRecord(root.message).content);
  if (direct) return direct;

  const parts: string[] = [];
  for (const output of asArray(root.output)) {
    const outputRecord = asRecord(output);
    for (const content of asArray(outputRecord.content)) {
      const contentRecord = asRecord(content);
      const text = asString(contentRecord.text) ?? asString(contentRecord.output_text);
      if (text) parts.push(text);
    }
  }
  for (const step of asArray(root.steps)) {
    const stepRecord = asRecord(step);
    const eventContent = asString(asRecord(stepRecord.data).content);
    if (eventContent) parts.push(eventContent);
    if (stepRecord.type !== "model_output") continue;
    for (const content of asArray(stepRecord.content)) {
      const text = asString(asRecord(content).text);
      if (text) parts.push(text);
    }
  }
  return parts.join("\n");
}

export function extractAnnotations(value: unknown): JsonValue[] {
  const root = asRecord(value);
  const annotations: JsonValue[] = [];
  for (const citation of asArray(root.citations)) annotations.push(toJsonValue(citation));
  for (const output of asArray(root.output)) {
    for (const content of asArray(asRecord(output).content)) {
      for (const annotation of asArray(asRecord(content).annotations)) annotations.push(toJsonValue(annotation));
    }
  }
  for (const step of asArray(root.steps)) {
    for (const content of asArray(asRecord(step).content)) {
      for (const annotation of asArray(asRecord(content).annotations)) annotations.push(toJsonValue(annotation));
    }
  }
  return annotations;
}

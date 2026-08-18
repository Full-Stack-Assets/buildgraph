import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schemaDirectory = resolve(import.meta.dirname, "..", "schemas");

function listSchemaFiles(directory: string): string[] {
  return readdirSync(directory)
    .map((entry) => resolve(directory, entry))
    .filter((entry) => statSync(entry).isFile() && entry.endsWith(".schema.json"));
}

describe("canonical schemas", () => {
  it("are valid JSON documents with stable BuildGraph identifiers", () => {
    const schemas = listSchemaFiles(schemaDirectory);

    expect(schemas.length).toBeGreaterThanOrEqual(8);

    for (const schemaPath of schemas) {
      const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as Record<string, unknown>;
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(typeof schema.$id).toBe("string");
      expect(String(schema.$id)).toContain("https://buildgraph.local/schemas/");
      expect(typeof schema.title).toBe("string");
    }
  });
});

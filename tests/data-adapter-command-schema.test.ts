import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { registerBuildGraphFormats } from "../scripts/ajv-formats.js";

const root = resolve(import.meta.dirname, "..");

describe("data adapter operational command schema", () => {
  it("accepts every checked-in operator example", async () => {
    const [grantSchema, commandSchema] = await Promise.all([
      readFile(resolve(root, "schemas/data-action-grant.schema.json"), "utf8").then((value) => JSON.parse(value) as object),
      readFile(resolve(root, "schemas/data-adapter-command.schema.json"), "utf8").then((value) => JSON.parse(value) as object)
    ]);
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    registerBuildGraphFormats(ajv);
    ajv.addSchema(grantSchema);
    const validate = ajv.compile(commandSchema);
    for (const path of [
      "config/canon-write-command.example.json",
      "config/canon-inference-command.example.json",
      "config/canon-phone-instruction.example.json"
    ]) {
      const value = JSON.parse(await readFile(resolve(root, path), "utf8")) as unknown;
      expect(validate(value), `${path}: ${ajv.errorsText(validate.errors)}`).toBe(true);
    }
  });

  it("accepts the checked-in iPhone action grant example", async () => {
    const schema = JSON.parse(await readFile(resolve(root, "schemas/phone-action-grant.schema.json"), "utf8")) as object;
    const value = JSON.parse(await readFile(resolve(root, "config/canon-phone-action-grant.example.json"), "utf8")) as unknown;
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    registerBuildGraphFormats(ajv);
    const validate = ajv.compile(schema);
    expect(validate(value), ajv.errorsText(validate.errors)).toBe(true);
  });
});

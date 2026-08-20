import type { Ajv2020 } from "ajv/dist/2020.js";

const nonWhitespaceReference = /^\S+$/;

export function registerBuildGraphFormats(ajv: Ajv2020): void {
  ajv.addFormat("date-time", {
    type: "string",
    validate: (value: string) => value.includes("T") && !Number.isNaN(Date.parse(value))
  });

  ajv.addFormat("uri-reference", {
    type: "string",
    validate: (value: string) => nonWhitespaceReference.test(value)
  });

  ajv.addFormat("uuid", {
    type: "string",
    validate: (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
  });
}

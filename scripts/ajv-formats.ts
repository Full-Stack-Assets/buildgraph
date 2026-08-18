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
}

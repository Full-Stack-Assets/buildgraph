import { createControlledAdapter } from "../core.js";

export const githubAdapter = createControlledAdapter({
  runtime_id: "github",
  adapter_version: "0.1.0",
  maximum_supported_tier: "I2",
  supports_structured_result: true,
  supports_draft_creation: true,
  supports_pull_request_creation: true,
  execution_boundary: "projection-and-receipt-only"
});

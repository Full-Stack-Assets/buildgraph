import { createControlledAdapter } from "../core.js";

export const openaiAdapter = createControlledAdapter({
  runtime_id: "openai",
  adapter_version: "0.1.0",
  maximum_supported_tier: "I2",
  supports_structured_result: true,
  supports_draft_creation: true,
  supports_pull_request_creation: false,
  execution_boundary: "projection-and-receipt-only"
});

# CANON MCP Gateway Recovery Plan

## Phase 0 — contract and safety

1. Add provider-neutral source, grant, operation, error, and receipt types.
2. Add an allowlist that excludes mutation tools.
3. Add state classification and cursor-commit invariants.
4. Add redaction and size/timeout policy tests.

## Phase 1 — gateway core

1. Implement a transport-neutral gateway dispatcher.
2. Implement connection listing and bounded probes.
3. Normalize provider errors without converting failures to empty results.
4. Emit append-only receipt envelopes.

## Phase 2 — adapters

1. Gemini: OAuth-gated metadata, File Search, and bounded inference.
2. Work IQ: read-only fetch/ask/schema/search delegation.
3. Apple companion: independent grant manifests and selected-directory/file relay.
4. iPhone: selected Files access through the signed companion and private relay.

## Phase 3 — verification

- Unit and property tests for policy and state classification.
- MCP protocol discovery and structured-error tests.
- Replay/idempotency and cursor durability tests.
- Secret/personal-data redaction scans.
- Simulator/device canaries after Apple credentials and signing are supplied.

No live provider or device operation is considered connected until its bounded canary succeeds.

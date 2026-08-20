# CANON MCP Connections Design

Status: approved for implementation
Branch: feat/canon-mcp-gateway-recovery

## Objective

Extend the existing provider/device fabric with a governed, provider-neutral MCP gateway for Gemini, Microsoft Work IQ/Copilot, iCloud domains, and selected iPhone Files access.

## Authority boundary

The gateway is read-first. No generic write or delete tool is exposed. Provider credentials, Apple security-scoped bookmarks, Entra tokens, and raw personal payloads never appear in MCP responses, logs, or receipts.

## Exposed contract

- connections_list
- connections_probe
- source_list_changes
- source_read
- apple_grants_status
- gemini_ask
- workiq_fetch
- workiq_ask

Every operation returns a source-specific state, provenance, limits, and receipt reference.

## Apple scope

Independent, revocable grants for selected iCloud Drive/Files directories, Photos, Contacts, Reminders, and Calendar. Notes remains export-only. Whole-device filesystem access is not represented.

## Fail-closed rules

Authentication failure is AUTH_REQUIRED, consent is CONSENT_REQUIRED, policy denial is BLOCKED, unavailable device/provider is UNREACHABLE or UNAVAILABLE, and an empty result is NO_RESULTS only after an authorized query succeeds. Cursors advance only after durable commit.

## Human gates

Gemini OAuth, Work IQ Entra/admin consent and billing, Apple signing/entitlements/device permissions, and any future write or remote-HTTP activation require explicit human action.

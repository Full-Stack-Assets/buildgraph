# Canon Provider and iPhone Data Fabric v1.1

## Implementation state

The Grok, Gemini, Copilot, private CloudKit, and user-selected iPhone storage paths are implemented through their locally testable boundary. The server includes health/capability commands, schema-validated write/inference/phone-instruction commands, continuous retrieval, autonomous retrieval, durable storage, fail-closed action idempotency, process leases, provenance, receipts, and dead letters. All mutations and inference remain disabled until an operator supplies credentials, allowlists, fresh grants, and explicit switches.

| Provider | Required deployment input | Supported resource scope |
|---|---|---|
| Grok | `XAI_API_KEY`; `XAI_MANAGEMENT_API_KEY` for Collections; `XAI_COLLECTION_IDS` allowlist | `file:new`, `collection:collection_id` |
| Gemini | `GEMINI_API_KEY`; `GEMINI_FILE_SEARCH_STORES` allowlist | `files:new`, `fileSearchStores/store_id` |
| Copilot | Optional `@github/copilot-sdk@^1.0.11`, eligible account/CLI authentication, scoped working directory | `session:new`, `session:session_id` |
| CloudKit | Container ID, environment, server API token, delegated web-auth token, private database and custom zone | `record:record_name` |
| iPhone | Host app, CloudKit entitlement/container, selected folder bookmark, fresh `PhoneActionGrant` | Relative paths below the selected root |

The adapters use the official [xAI Files/Collections](https://docs.x.ai/developers/files/collections/api), [xAI Collections Search](https://docs.x.ai/developers/tools/collections-search), [Gemini Files](https://ai.google.dev/gemini-api/docs/files), [Gemini File Search](https://ai.google.dev/gemini-api/docs/file-search), [GitHub Copilot SDK](https://github.com/github/copilot-sdk/blob/main/nodejs/README.md), and [CloudKit Web Services](https://developer.apple.com/library/archive/documentation/DataManagement/Conceptual/CloudKitWebServicesReference/Introduction.html) surfaces. They do not scrape consumer applications or bypass platform sandboxes.

## Install and local validation

Use Node.js 22.12 or newer. Copilot is an optional peer so the remaining adapters do not require it.

```bash
npm ci
npm install --no-save @github/copilot-sdk@^1.0.11   # only in a Copilot-enabled deployment
npm run validate
```

The repository’s macOS CI job compiles the Swift package for an iOS simulator and runs its platform-neutral authority tests. A Linux checkout cannot run Xcode or activate Apple entitlements.

## Configure a deployment

Start with `.env.example` and inject secrets through the deployment secret manager. At minimum set:

```bash
export CANON_SYNC_ADAPTERS=grok,gemini
export CANON_SYNC_ROOT=/srv/canon/provider-sync
export CANON_ACTION_PAYLOAD_ROOT=/srv/canon/action-payloads
export CANON_ENABLE_WRITES=false
export CANON_ENABLE_INFERENCE=false
```

`CANON_SYNC_ADAPTERS` is mandatory and must list only configured adapters. Storage roots must be absolute and cannot be filesystem roots. Provider collection/store lists are deployment allowlists, not discovery hints.

Check configuration without mutation:

```bash
npm run adapters:capabilities
npm run adapters:health
npm run sync:once
```

Health returns a nonzero status when any selected provider is not healthy. A credential proves provider access only; it does not enable Canon writes or inference.

## Continuous document retrieval

```bash
npm run sync:once
npm run sync:daemon
```

Only one sync daemon can hold the durable lease. `CANON_SYNC_MAX_PAGES`, provider byte limits, the sink byte limit, HTTP response bounds, and cursor length prevent unbounded cycles. Oversized provider items are retained as metadata-only records. Transient list/read/ingest/checkpoint failures create redacted dead letters and never advance an incomplete page.

## Governed writes

1. Place a regular, non-symlink payload below `CANON_ACTION_PAYLOAD_ROOT`.
2. Copy `config/canon-write-command.example.json` and replace all placeholders, including the future example dates, with a fresh short-lived grant and unique idempotency key.
3. Explicitly enable writes for the deployment.
4. Run the command.

```bash
export CANON_ENABLE_WRITES=true
npm run adapter:write -- --file /srv/canon/config/write-command.json
```

Destination rules are exact:

| Adapter | Create | Update/append |
|---|---|---|
| Grok | `file:new` or an allowlisted `collection:<id>` | Unsupported; create an immutable new file |
| Gemini | `files:new` or an allowlisted File Search store | Unsupported; create an immutable new file/import |
| Copilot | `session:new` | `session:<id>`; append semantics |
| CloudKit | `record:<name>` | `record:<name>` with `expectedVersion` and approval |

Before an external mutation, the runner writes an action record with state `STARTED`. A conclusive provider response changes it to `COMPLETED` and stores the receipt. An exception changes it to `FAILED_UNCERTAIN`; replaying that idempotency key is blocked. Reconcile the provider object first, then issue a new key only when a human has established the correct next action.

## Governed inference and autonomous retrieval

For a one-off request, copy `config/canon-inference-command.example.json`, issue a fresh inference grant covering every resource, then run:

```bash
export CANON_ENABLE_INFERENCE=true
npm run adapter:infer -- --file /srv/canon/config/inference-command.json
```

For continuous retrieval, copy `config/canon-retrieval-jobs.example.json` and run:

```bash
export CANON_RETRIEVAL_JOBS_FILE=/srv/canon/config/retrieval-jobs.json
npm run retrieve:once
npm run retrieve:daemon
```

Set `CANON_REQUIRE_INFERENCE_APPROVAL=true` when every inference needs a matching approval reference. Adapter-managed Copilot sessions have no authorized tools: the empty tool set, permission handler, and pre-tool hook all deny execution.

## CloudKit and iPhone setup

The server and app must use the same private `CanonSyncZone` and the record types `CanonDocument`, `CanonWriteInstruction`, and `CanonWriteReceipt`.

1. Create separate development and production CloudKit containers/schemas.
2. Configure the server API token and obtain a delegated Apple user web-auth token for private database access.
3. Add `mobile/CanonPhoneBridge` to an iOS 17+ Xcode app. Replace the entitlement placeholder, enable iCloud Documents/CloudKit and Background processing, and configure the permitted background task identifier.
4. Present a folder picker and save only the resulting security-scoped bookmark with `SecurityScopedRootStore`.
5. Copy `config/canon-phone-action-grant.example.json`, replace the dates and IDs, and decode it with `PhoneActionGrantJSON`. Include `upload` for device-to-CloudKit reads; `create`/`update` alone never authorize upload.
6. Construct `LocalDocumentAdapter`, `CloudKitSyncAdapter`, and `PhoneSyncCoordinator`; run a foreground canary before scheduling background work.

Server-to-device writes use the typed command:

```bash
npm run iphone:instruction -- --file /srv/canon/config/phone-instruction.json
```

Start from `config/canon-phone-instruction.example.json`. Instruction expiry must be no more than 24 hours away. Updates require the same approval on the server grant and device grant plus the expected current local SHA-256. The device applies an instruction only when its root ID and action-grant ID match the active grant. Failed instructions leave that root’s CloudKit cursor uncommitted.

## Live verification gate

The repository cannot perform these identity- or device-bound steps without the owner:

1. inject least-privilege xAI, Gemini, CloudKit, and optional Copilot credentials;
2. install/authenticate the optional Copilot SDK deployment;
3. create/promote the CloudKit schema and delegated web-auth session;
4. sign a host iOS app, enable the entitlement, select a directory, and issue a fresh phone action grant;
5. approve disposable provider writes/inference and run physical-device revocation, conflict, replay, and recovery canaries;
6. record independent acceptance before changing any integration from `TESTED` to `VERIFIED`.

Until those steps occur, keep writes and inference off. The deterministic suite proves contracts and fail-closed behavior; it does not claim live vendor entitlement or physical-device readiness.

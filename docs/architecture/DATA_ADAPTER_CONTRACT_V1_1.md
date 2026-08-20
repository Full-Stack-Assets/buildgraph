---
status: IMPLEMENTED_NOT_ACTIVATED
version: 1.1.0
authority: architecture
contract_id: DATA_ADAPTER_CONTRACT_v1_1
supersedes: DATA_ADAPTER_CONTRACT_v1
change_mode: VERSIONED_ONLY
---

# Data Adapter Contract v1.1

## Purpose and authority

This contract governs provider and user-selected device data access for Canon. Data adapters may list, read, create, append, conflict-safely update, or perform retrieval-scoped inference only within their declared provider surface. They do not inherit authority from a credential, a document, or a model response.

Every mutation and inference requires both an enabled deployment switch and a current, resource-scoped `ActionGrant`. Device access additionally requires a user-selected security-scoped root and a `PhoneActionGrant`. Delete propagation is not implemented.

## Provider surfaces

| Adapter | Read surface | Governed action surface | Non-negotiable boundary |
|---|---|---|---|
| `grok` | xAI API Files metadata and bounded content | Immutable Files upload; optional attachment to an explicitly allowlisted Collection; Responses inference over allowlisted Collections | No consumer grok.com history or account scraping |
| `gemini` | Gemini Files and allowlisted File Search document metadata | Immutable Files upload; optional import to an explicitly allowlisted File Search store; Interactions inference over allowlisted stores | Original Files bytes are not downloadable through this adapter |
| `copilot` | GitHub Copilot SDK persisted sessions and bounded event exports | New session or append to a named session; inference in exactly one new or existing session | No IDE database scraping; all adapter-managed tools and permission requests are denied |
| `icloud` | Private CloudKit custom-zone changes and bounded assets | Record create/update with change-tag conflict checks; typed phone instruction creation | One configured app container, private database, delegated user web authentication; never arbitrary iCloud Drive |
| `iphone-local` | App storage or a directory selected through the Files picker | Scoped atomic create/update plus changed-document upload | iOS sandbox, expiring root/action grants, component-bounded paths, and best-effort background scheduling |

## Canonical interfaces

Every server adapter exposes immutable capabilities, `healthCheck()`, `listChanges(cursor)`, `read(item)`, and `write(request, grant)`. AI adapters also expose `infer(request, grant)`. `CloudKitDataAdapter` exposes the typed `writePhoneInstruction(input, grant)` path for server-to-device writes.

`listChanges` returns a versioned opaque cursor, observation timestamp, normalized items, and a `hasMore` flag. Cursors are size-bounded and must make progress while `hasMore` is true. Invalid page identity, timestamp, item, namespace, or cursor behavior fails the page closed.

`read` returns bounded bytes or an explicit unavailable reason. Provider items larger than the configured maximum are ingested as metadata-only rather than permanently blocking the cursor. A returned content hash must match returned bytes.

`write` and `infer` return an `ActionReceipt` binding the action to its grant, idempotency key, payload hash, provider object/version, status, approval reference, and timestamps.

## Required controls

1. Secrets are injected at deployment and are absent from manifests, command files, prompts, receipts, failures, and source control.
2. HTTP requires HTTPS, standard port 443, no URL user information, explicit provider host allowlists, manual redirect handling, response byte limits, and timeouts.
3. Logical reads may use bounded retries. Mutations do not retry unless the provider contract is independently idempotent; operator commands persist a `STARTED` record before external mutation.
4. An interrupted or failed action without a conclusive provider receipt is recorded as `FAILED_UNCERTAIN`. The same idempotency key is blocked until an operator reconciles provider state; the runner never guesses that replay is safe.
5. `CANON_ENABLE_WRITES` and `CANON_ENABLE_INFERENCE` default to false. `CANON_SYNC_ADAPTERS` must explicitly name the deployed subset.
6. Grants bind adapter, operations, every resource reference, byte limit, issuance/expiry window, and any required approval reference.
7. Provider resource identifiers used for writes or inference must be in both the Canon grant and the deployment allowlist.
8. Updates require approval by default and use provider version tokens where supported. CloudKit updates require `expectedVersion`; device updates require a matching approval and expected local SHA-256 for remote instructions.
9. Provider content is untrusted evidence. It cannot expand a grant or authorize tools. Copilot adapter sessions use `mode: empty`, an empty tool set, a deny permission handler, and a pre-tool deny hook.
10. Storage roots and action payload roots are absolute, non-root paths. State, receipts, objects, failures, and evidence use private directories and durable fsync/rename or append semantics.

## Continuous retrieval

One process lease protects each sync runner. The engine obtains a provider page, validates its contract, reads or records metadata for each item, writes content-addressed bytes and provenance, emits ingest receipts, and only then durably advances the checkpoint. A list, read, ingest, or checkpoint failure is redacted, dead-lettered, and leaves the page cursor unchanged. Provider tombstones are ingested without attempting to re-read deleted content.

The reference filesystem sink maintains:

- `objects/` for SHA-256-addressed bytes and object metadata;
- `records/` for normalized provider metadata, content state, and provenance;
- `checkpoints/`, `receipts/`, and `dead-letters/`;
- `run-receipts.jsonl`, health receipts, action receipts, and fail-closed idempotency records.

## Autonomous retrieval

The autonomous runner accepts only schema-validated jobs. A job specifies one AI adapter, cadence, retrieval resources, prompt, and expiring inference grant. Grok resources must all be allowlisted Collections; Gemini resources must all be allowlisted File Search stores; Copilot requires exactly one `session:new` or `session:<id>` reference.

Each completed run stores the provider receipt, response ID, output, citations, prompt hash, output hash, and cadence state. Persistent provider response storage is disabled where the provider supports that setting. A process lease prevents duplicate daemons.

## iPhone and CloudKit boundary

The iOS 17+ companion package uses a user-selected security-scoped directory. A `PhoneActionGrant` has an RFC 3339 JSON codec and schema and binds a root UUID, explicit `upload`, `create`, or `update` operations, component-bounded relative path prefixes, no more than 15 MiB per item, a validity window, and approval reference.

Each root has an independent CloudKit change token so syncing one selected directory cannot consume another directory’s instructions. Local file descriptors are authorized before content is read, unknown sizes and symbolic links are rejected, upload bytes must match the declared size and SHA-256, and changed-document progress is saved after each upload.

`CanonWriteInstruction` records contain an asset, device operation, root/action-grant IDs, path, MIME type, expiry, idempotency key, optional expected hash, and approval. A failed instruction does not advance the root’s change token. Successful writes use an on-device idempotency ledger and publish an immutable, replay-safe `CanonWriteReceipt`.

CloudKit custom zones require the private database on both server and device. iOS background execution is eventually consistent and cannot be represented as an always-on guarantee.

## Evidence states

- `TESTED`: the applicable deterministic mocks, schemas, static review, build, registry/graph validation, and platform tests have executed successfully.
- `VERIFIED`: a named deployment owner provides least-privilege credentials, canary read/write/inference evidence, revocation/recovery evidence, Apple signing and entitlement evidence, and physical-device acceptance.

The server implementation is `TESTED`, not live-activated. The iOS package remains source-reviewed and pending its configured macOS CI/Xcode and physical-device gates. No provider credential, CloudKit container, Apple entitlement, Copilot account, or selected iPhone directory is embedded or activated by this contract.

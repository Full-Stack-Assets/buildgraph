# BuildGraph Further Development and Improvement Plan

**Status:** Proposed planning baseline for implementation.  
**Date:** 2026-08-18  
**Evaluated revision:** `main` at `02498fd`  
**Authority boundary:** BuildGraph v0 remains I0–I2. This plan does not authorize I3/I4 execution, credential brokerage, production deployment, protected-branch merge, payment, external publication, or unrestricted runtime tool access.

This document is the working plan for further development **during implementation**. It reconciles the verified repository on `main`, the stale status documents, and the in-flight Agent Operating Company (AOC) architecture draft. It is not itself an architecture decision and does not promote any `TESTED` AOC claim to `VERIFIED`.

## 1. Evaluation of the current verified state

The local TypeScript repository is a governed control-plane foundation, not a live execution platform. The following are implemented and locally verified:

| Capability | Current state on `main` |
|---|---|
| Governance baseline | Private repo, `CODEOWNERS`, `SECURITY.md`, CI lint/typecheck/test, ADR-001 |
| Canonical schemas | Portfolio, project, role, skill, integration, policy, workflow, runtime, task, result, passport, approval, graph entity, graph edge |
| Registry | 40 YAML manifests: 1 portfolio, 1 project, 6 roles, 18 skills, 6 integrations, 4 policies, 4 runtimes; **zero workflow manifests** |
| Policy packs | Risk, approval, data-handling, and release controls; I3/I4 disabled |
| Runtime adapters | Manus, OpenAI, Cursor, and GitHub projection/receipt adapters with I2 fail-closed enforcement |
| Capability router | Deterministic, kill-switch-aware route that emits a TaskEnvelope and AgentPassport or `BLOCKED` |
| Canonical graph | Unit 15-E compiler, content-addressed snapshot, JSONL exports, validation report, name-similarity preflight |
| ClickUp Mission Control | Public API client, lane whitelist, idempotency ledger with stale-lease recovery, bounded queue, approval-gated protected status, read-only `npm run clickup:verify` |
| Tests | 15 files, 40 passing tests |

Current graph evidence from `generated/buildgraph/validation/report.json`:

- 40 entities, 69 edges, 0 conflicts, 0 errors, 0 warnings
- Content hash `575629e9aee6c499e267084fd821af66843e5dc3d3157fb5510669bffbb19751`

What is **not** implemented, despite directory or documentation presence:

- `evals/` contains only a README; no role, skill, policy, or adapter evaluation suite exists
- `registry/workflows/` does not exist; `WorkflowSpec` is a schema without a canonical instance
- `compilers/` is listed in `README.md` and `CODEOWNERS` but does not exist; projection lives in `graph/` and `adapters/`
- Skill manifests reference `fixtures/skills/*` files that are absent
- Envelope, graph, and security validation are not unified behind one CLI or error model
- ClickUp writes are not yet bound to TaskEnvelope, AgentPassport, or ResultEnvelope evidence
- Approval records are schema-validated in fixtures, but no adapter loads and checks a canonical ApprovalRecord
- Grok and Claude remain type-level runtime IDs without adapter implementations or evaluation evidence

## 2. Drift that will mislead implementation if left uncorrected

Several documents still describe a frontier that `main` has already passed. Treat the table below as the evaluation finding, not as a license to expand scope.

| Document | Stale claim | Verified fact |
|---|---|---|
| `docs/IMPLEMENTATION_STATUS.md` | 39 manifests, 6 test files / 11 tests; next increment is a pilot workflow | 40 manifests, 15/40 tests; ClickUp INT-021 and Unit 15-E are on `main` |
| `docs/EXECUTABLE_CLOSURE_ASSESSMENT.md` | Graph compiler, snapshot, and preflight are not implemented | Unit 15-E is complete; next serial unit is 16-E |
| `docs/ARCHIVE_UNIT_MAPPING.md` | Capability router is the next compatible unit | `router/capability-router.ts` is implemented and tested |
| `docs/EXPANDED_ARCHIVE_INVENTORY.md` | Next safe target is Unit 15-E | 15-E is complete |
| `README.md` development sequence | Ends at Unit 15-E and lists a `compilers/` tree | Sequence must continue at 16-E; compiler code lives in `graph/` |
| Approval policy | “Execution-capable adapters are deferred” | ClickUp Mission Control is an I2 write adapter; runtime adapters remain projection-only |

**Implementation rule:** every subsequent unit must refresh `docs/IMPLEMENTATION_STATUS.md` and the generated graph snapshot in the same change as the code. Status drift is now a blocking quality defect, not a documentation nicety.

## 3. In-flight work that must not be rebuilt

Draft PR [#3](https://github.com/Full-Stack-Assets/buildgraph/pull/3) (`feat/aoc-canonical-architecture-v1`) already extends BuildGraph with AOC Canonical Architecture v1:

- Organization and ten permanent divisions
- First-class Product, Capability, AgentDefinition, AgentInstance, Factory, WorkOrder, ExecutionRun, Tool, Provider, Evidence, Verification, Artifact, Decision, and Constraint schemas
- 13-capability seed registry and nine runtime profiles
- Controlled relationship vocabulary and a stronger offline preflight
- Source-library reconciliation matrix (198 classified records)
- Evidence state `TESTED`, explicitly **not** `VERIFIED`

**During implementation of this plan:**

1. Do not create a parallel AOC repository or a second ontology.
2. Do not merge PR #3 as `VERIFIED` on the strength of automated tests.
3. Do not import the 123-role / 45-skill source library wholesale. Promote only capability-backed KEEP/MERGE items after independent reconciliation review.
4. Land Unit 16-E against current `main` first, then rebase or absorb AOC so new kinds enter through the unified validator rather than expanding an already-split validation surface.
5. Keep RoleSpec and SkillSpec as v1.x compatibility aliases if AOC lands; do not rename existing graph IDs.

## 4. Decision gates that still block later units

ADR-001 remains binding. The following decisions must be recorded before the named work starts. Until then, implementers stay inside the I0–I2 registry, validation, projection, and bounded ClickUp lane path.

| Gate | Blocks | Interim implementation posture |
|---|---|---|
| First operational domain and pilot workflow | First `WorkflowSpec`, Temporal, n8n, autonomous loops | Keep workflow schema; do not invent a production workflow |
| Work-management source of truth | ClickUp vs Linear split, event ingress | ClickUp INT-021 remains the sandbox Mission Control binding; INT-003 stays generic |
| Canonical knowledge source and retention | Notion/Workspace connector, INT-001 activation | Knowledge remains a declared integration, not a live connector |
| Named human owners per role, data, policy, and evaluation | Promotion of `pilot` roles to `approved`; `VERIFIED` claims | Owner fields stay `Full-Stack-Assets` until named |
| Persistent execution (Temporal) and low-risk event ingress (n8n) | Units 8–10 archive work | No scheduler, webhook, or worker process |
| Any move above I2 or action-capable production integration | I3/I4 adapters, production GitHub merge, billing, identity | Continue rejecting authority above I2 |

## 5. Serial implementation sequence

Work proceeds in this order unless a later ADR supersedes it. Each unit is executable without live credentials except where explicitly labeled as an operator-only smoke check.

### Unit 16-E — Unified validation CLI and machine-readable error model

**Why this is next:** validator, graph compiler, and router each load YAML, walk the registry, and emit ad hoc strings. Envelope schemas are only exercised in tests. CI runs lint/typecheck/test and skips `validate:registry` / `validate:graph`. AOC will add many kinds; the error model must exist before that surface grows.

**Deliver:**

1. A shared library (suggested `validation/`) that loads YAML, compiles AJV 2020 schemas, and returns a stable error object: `code`, `severity`, `path`, `object_id`, `field`, `message`, `blocking`.
2. One CLI, for example `npm run validate:all` / `tsx scripts/validate.ts`, covering:
   - JSON Schema compilation
   - registry manifests and cross-references
   - task, result, passport, and approval envelope fixtures
   - graph compilation, schema validation of entities/edges, content-hash check
   - optional security lint: no plaintext credential-like values in registry/config
3. Machine-readable stdout (`--format json`) plus human stderr summary; nonzero exit on any blocking error.
4. CI updated to run the unified command, not a subset.
5. `tsconfig.json` include of `graph/`, `router/`, and the new validation module. Today typecheck only lists `scripts/`, `tests/`, and `adapters/`.
6. Fail closed on unknown manifest kinds instead of silently skipping them in `compileGraph`.

**Out of scope:** network calls, ClickUp token use, API/UI, AOC entity kinds until PR #3 is reviewed.

### Unit 17-E — Evaluation harness and skill-fixture closure

**Why this is next:** every SkillSpec already declares evaluation fixtures and acceptance criteria, but `fixtures/skills/` does not exist and `evals/` is empty. SKL-045 cannot execute a scorecard gate without fixtures. This is the cheapest way to make the registry honest.

**Deliver:**

1. Canonical fixture files for each skill path already named in the registry.
2. An eval runner that is independent of the runtime under test, as required by `evals/README.md`.
3. First suites:
   - skill fixture presence and schema
   - router fail-closed cases (kill switch, unauthorized integration, I2 ceiling)
   - ClickUp policy gates (unknown lane, missing approval reference, stale lease)
   - graph determinism and dangling-edge blocking
4. Registry validation that referenced fixture paths exist.

**Out of scope:** live model scoring, reputation, multi-agent competition.

### Unit 18-E — Bind ClickUp Mission Control to canonical envelopes

**Why this is next:** ClickUp is the only I2 write path, but it is a side adapter. Tasks can mutate Mission Control without a TaskEnvelope, passport, or ResultEnvelope. That splits the evidence graph.

**Deliver:**

1. Require TaskEnvelope + AgentPassport (or a narrower governed work ticket derived from them) before mutating a lane.
2. Load and validate a canonical ApprovalRecord for protected status transitions; a string reference is not sufficient.
3. Normalize successful and failed mutations into ResultEnvelope receipts with provenance, quality evidence, risks, and next handoff.
4. Record lane, list ID, ClickUp task ID, idempotency key, and rate-limit snapshot as evidence references—not as a second source of truth.
5. Keep the existing fail-closed behaviors: unknown lane, queue overflow, ambiguous POST 5xx, workspace mismatch.

**Out of scope:** webhooks, OAuth app registration, Redis/Postgres idempotency, delete/admin/billing APIs, CI jobs that use `CLICKUP_API_TOKEN`.

### Unit 19-E — First WorkflowSpec after the ADR-001 domain decision

Only after the first operational domain and work-management source of truth are recorded.

**Deliver:** a single pilot `WorkflowSpec` (manual trigger, I2 ceiling, named escalation owner) that uses existing roles/skills and, if ClickUp remains the work queue, INT-021 lanes. The workflow compiler projects steps; it does not start a worker.

### Downstream units (unchanged deferrals)

Event fabric, credential broker, durable execution, external observability backend, agent reputation, multi-agent competition, autonomous domain loops, public API/UI, and federation remain downstream of 16-E through 19-E and the ADR-001 gates.

## 6. Improvement work that should happen during those units

These are not separate product features. They should be folded into the serial units so implementation quality does not wait for a cleanup pass.

### 6.1 Continuous integration and package hygiene

| Improvement | Fold into |
|---|---|
| CI runs unified validation, including registry and graph | 16-E |
| CI fails if `generated/buildgraph/` is stale versus a fresh compile | 16-E |
| Include `graph/` and `router/` in `tsconfig.json` | 16-E |
| Correct README repository map (`graph/`, `router/`; remove or create `compilers/`) | 16-E |
| Align `CODEOWNERS` with actual trees | 16-E |
| Snapshot retention: stop accumulating unbounded `generated/buildgraph/snapshots/` files without a policy | 16-E |
| `package.json` `validate` becomes the one command CI and humans run | 16-E |

### 6.2 Shared internals

Validator, compiler, and router duplicate `listFiles`, YAML parse, and tier scoring. Extract them once in 16-E. Do not add a framework or extra runtime dependency.

Graph entity/edge JSON schemas exist but `validateGraph` only checks required fields and dangling edges. 16-E should validate generated graph objects against those schemas.

Preflight on `main` is canonical-name Jaccard similarity. Keep it offline and deterministic. If AOC’s richer preflight (payload hash, four similarity dimensions, Waste Risk) is accepted, it replaces this function in place rather than adding a second engine.

### 6.3 ClickUp operationalization without authority expansion

During 18-E, keep the current I2 lane map and lease settings. Operator-only live `npm run clickup:verify` remains outside CI. Document that a hosted ClickUp MCP session is not evidence that the Public API path is live.

Do not treat ClickUp as a runtime. It is an IntegrationSpec (`INT-021`) used by roles. Runtime adapters stay projection-and-receipt-only.

### 6.4 Registry honesty

| Gap | Fold into |
|---|---|
| Missing skill evaluation fixtures | 17-E |
| No WorkflowSpec | 19-E, after ADR-001 |
| Role/skill statuses remain `pilot` | leave until named owners and evals exist |
| INT-021 `approved_roles` vs generic INT-003 | keep both; 18-E documents the provider binding |
| Grok Operations roles GOS-01–06 | import as lineage-bearing RoleSpec/SkillSpec only after 17-E; do not add a Grok adapter |
| Google Sheets control plane | inventory-only IntegrationSpec; no writes |

### 6.5 Documentation discipline

Every unit PR must:

1. Update `docs/IMPLEMENTATION_STATUS.md` with current manifest, test, and graph counts.
2. State the next serial unit and the still-open ADR-001 gates.
3. Avoid claiming `VERIFIED`, `live`, or `complete` for connectors, runtimes, or AOC architecture without independent review evidence.
4. Keep archive mapping documents historical; put current frontier only in implementation status and this plan.

## 7. Recommended near-term PR slicing

Implementation agents should open small PRs in this order. Do not combine AOC absorption with CLI work.

| Slice | Contents | Depends on |
|---|---|---|
| 16-E.1 | Shared validation types, schema compilation, JSON error model | none |
| 16-E.2 | Registry + envelope + graph commands behind one CLI; unknown-kind fail-closed | 16-E.1 |
| 16-E.3 | CI, tsconfig, README/CODEOWNERS map, generated-graph freshness | 16-E.2 |
| 17-E.1 | Skill fixtures named by the current registry | 16-E |
| 17-E.2 | Eval runner and first offline suites | 17-E.1 |
| 18-E.1 | Envelope/passport/approval gating in ClickUp facade | 16-E, 17-E |
| 18-E.2 | ResultEnvelope receipts for ClickUp mutations | 18-E.1 |
| 19-E | First WorkflowSpec | ADR-001 domain and source-of-truth decisions |
| AOC review | Independent architecture and reconciliation review of PR #3 | 16-E recommended first |
| AOC absorb | Rebase PR #3 onto unified validator; keep evidence state `TESTED` | AOC review |

## 8. Risks if implementation ignores this plan

1. **Split validation.** AOC kinds, ClickUp writes, and envelope contracts will each grow their own checkers. Failures will not compose.
2. **False completeness.** Skill fixtures, evals, and workflow schemas look declared while being empty. Downstream agents will treat names as implemented capability.
3. **Evidence bypass.** ClickUp mutations without ResultEnvelopes create an unauditable work queue that looks like Mission Control.
4. **Architecture fork.** Building AOC features on `main` in parallel with PR #3 will duplicate ontology and graph IDs.
5. **Authority creep.** ClickUp I2 writes plus AOC capability claims can be misread as permission to activate I3 connectors, schedulers, or production GitHub actions.

## 9. Explicit non-goals until later ADRs

- I3 or I4 execution
- Grok, Claude, Gemini, Codex, or local runtime adapters without role-specific evaluation evidence
- Credential brokerage or secret provisioning
- Temporal workers, n8n, webhooks, or any always-on process
- Public API, web console, or federation
- Redis/Postgres idempotency or horizontally scaled ClickUp workers
- Production deployment, protected-branch merge, payment, identity change, or public communication
- Treating PR #3, mock receipts, archive `COMPLETE` files, or a connected MCP session as verified operational authority

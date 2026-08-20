# Claim vs Evidence Ledger

**Status:** Canonical claim filter for internal planning and any later confidential buyer brief.  
**Date:** 2026-08-18  
**Classification:** confidential  
**Rule:** If a statement is not in this ledger, it must not appear in a CIM, corp-dev deck, or outreach note.

Evidence states: `UNVERIFIED`, `DECLARED`, `TESTED`, `VERIFIED`, `SUPERSEDED`, `REVOKED`. Definitions are in `docs/ACQUISITION_READINESS.md` section 3.

`VERIFIED` requires independent human acceptance of a named claim, version, and scope. Automated tests alone produce `TESTED`.

## How to use this ledger

1. Acquisition artifacts may state `TESTED` and `VERIFIED` rows, with the cited command or review record.
2. `DECLARED` rows may be listed only as gaps or future work, never as current product capability.
3. Draft-branch rows are not `main` facts. Prefix them “draft PR #3 only.”
4. Do not promote a row by editing this table without new evidence in the same change.

## A. Verified `main` engineering claims

| Claim | State | Scope | Evidence | Must not be stretched into |
|---|---|---|---|---|
| Private governed registry with JSON Schema contracts | TESTED | v0.2 manifests on `main` | `npm run validate:registry`; schema compilation tests | Production control plane, multi-tenant SaaS |
| Cross-reference and I2 authority validation | TESTED | Registry validator | `tests/registry-validator.test.ts`; adapters reject I3 | I3/I4 execution is available |
| TaskEnvelope, AgentPassport, ResultEnvelope, ApprovalRecord schemas | TESTED | Fixture contracts | `tests/envelope-contracts.test.ts` | Approvals execute consequential actions |
| Manus, OpenAI, Cursor, GitHub adapters project and normalize receipts | TESTED | Projection-and-receipt-only | `tests/runtime-adapters.test.ts`, `tests/end-to-end.test.ts` | Those runtimes are invoked live |
| Capability router emits TaskEnvelope/Passport or BLOCKED | TESTED | Offline canonical manifests | `tests/router/capability-router.test.ts` | Autonomous production routing |
| Unit 15-E graph compiler, snapshot, content hash | TESTED | Local registry compile | `tests/graph-compiler.test.ts`; hash `575629e9aee6c499e267084fd821af66843e5dc3d3157fb5510669bffbb19751` | Live knowledge graph or observed connector health |
| ClickUp Mission Control I2 adapter (lanes, idempotency, lease recovery) | TESTED | Injected fetch; no CI token | ClickUp unit tests; `docs/integrations/clickup-mission-control.md` | Public API path is live; MCP session proves Public API |
| CI lint, typecheck, and unit tests | TESTED | GitHub Actions on push/PR | `.github/workflows/ci.yml` | CI proves registry/graph validity (it currently does not) |
| Independent architecture or security acceptance | UNVERIFIED | Entire product | None | “Enterprise-ready,” SOC 2, VERIFIED AOC |

## B. Declared or hollow items on `main`

| Claim | State | Scope | Evidence | Allowed phrasing |
|---|---|---|---|---|
| Evaluation suites | DECLARED | `evals/` README only | No runner, no cases | “Eval harness is planned as Unit 17-E” |
| Skill evaluation fixtures | DECLARED | Paths named on each SkillSpec | `fixtures/skills/` missing | “Fixtures are specified but not present” |
| WorkflowSpec | DECLARED | Schema only | No `registry/workflows/` | “Workflow schema exists; no instance” |
| Unified validation CLI / machine-readable errors | DECLARED | `package.json` `validate` script is a local compose, not CI | CI omits registry and graph | “Planned as Unit 16-E” |
| Grok and Claude runtime adapters | DECLARED | Type IDs on `RuntimeId` | No adapter modules, no evals | “IDs reserved; adapters deferred” |
| Approval execution | DECLARED | ApprovalRecord modeled | ClickUp checks a string reference only | “Approvals are modeled, not executed” |
| Customers, revenue, production deployment | UNVERIFIED | Company | None | Do not mention as existing |

## C. Draft PR #3 (AOC Canonical Architecture v1) — not merged

Prefix every use: **draft PR #3 only**. Independent architecture and reconciliation review is still required. Automated conformance on that branch is `TESTED` for the suite it ran, not `VERIFIED` for the company.

| Claim | State | Scope | Evidence | Must not be stretched into |
|---|---|---|---|---|
| AOC constitutional spec and ADR-002 exist on the draft branch | TESTED | Draft branch automated suite | PR #3 verification report | AOC is the operating company in production |
| Organization + ten permanent divisions as YAML | TESTED | Draft registry manifests | PR #3 registry validation | Divisions are staffed or executing work |
| 13 capability records CAP-001–CAP-013 | DECLARED | Seed capability registry | Capability files; no representative execution | “The company can do software build, conversion, financial analysis, …” |
| CAP-006 CLIENT_CONVERSION provider roles | DECLARED | None registered | Capability registry table | Sales engine or conversion product |
| CAP-007 CONTRACT_ANALYSIS | DECLARED | Partial GKE-06 support only | Capability registry table | Legal advice or contract execution |
| CAP-013 FINANCIAL_ANALYSIS | DECLARED | None registered | Capability registry table | Valuation, CIM, or deal advice |
| Runtime profiles for Gemini, Grok, Claude, Codex, local | DECLARED | Draft runtime YAML | Profiles without execution evidence | Those runtimes are supported |
| Source-library reconciliation (198 records) | TESTED | Matrix presence and checksums on draft branch | PR #3 verification report | 123 roles are canonical BuildGraph roles |
| Architecture independently accepted | UNVERIFIED | AOC v1 | Explicitly not VERIFIED | Merge-as-canonical or buyer representation that AOC is complete |

## D. Forbidden representations

Do not write any of the following in acquisition materials:

1. Full Stack Assets is a ten-division operating company with executing factories.
2. BuildGraph is in production, has customers, or has ARR.
3. ClickUp MCP or a local `.runtime` file proves a live Public API control plane.
4. Agents can approve, pay, sign, merge to protected branches, or close a transaction.
5. Grok, Claude, Gemini, or Codex adapters exist on `main`.
6. PR #3 tests equal independent verification.
7. The archive, prototype database, or Python reference generator is the product being sold.
8. This repository values the company or solicits an offer.

## E. Allowed one-sentence wedge

When outreach gates in `docs/ACQUISITION_READINESS.md` have passed, the Human Principal may use:

> BuildGraph is a policy-first, runtime-independent control plane that compiles versioned roles, skills, integrations, and policies into fail-closed task projections and an auditable evidence graph.

Any broader sentence requires a new ledger row and evidence.

# Full Stack Assets Acquisition Readiness

**Status:** Internal sell-side planning baseline. Confidential. Not a representation, offering, valuation, or legal advice.  
**Date:** 2026-08-18  
**Classification:** confidential  
**Authority boundary:** ADR-001 remains binding. This document does not authorize financial action, legal assertion, public publication, I3/I4 execution, buyer contact by an agent, or any change to the v0 I2 ceiling.

This is **sell-side readiness** for a possible later acquisition of Full Stack Assets / BuildGraph. It is not a plan to productize an M&A department inside the Agent Operating Company, and it is not a license for agent-led outreach.

Related documents:

- Technical sequence: `docs/FURTHER_DEVELOPMENT_PLAN.md`
- Claim vs evidence: `docs/CLAIM_EVIDENCE_LEDGER.md`
- v0 authority: `docs/adr/ADR-001-buildgraph-v0-scope.md`
- Verified engineering state: `docs/IMPLEMENTATION_STATUS.md`

## 1. Intention

Find a corporate or financial **M&A / Corporate Development** group that could acquire Full Stack Assets / BuildGraph.

Agents may draft internal artifacts. Only the **Human Principal** may contact buyers, make representations, retain counsel, or decide that outreach gates have passed.

## 2. Honest current posture

Today this is **not a going-concern sale**. It is, at best, a future **IP tuck-in or acqui-hire**.

Verified facts on `main`:

- Private `UNLICENSED` package `@full-stack-assets/buildgraph` v0.1.0
- Governed registry, capability router, Unit 15-E graph compiler, and sandbox ClickUp Mission Control adapter
- No customers, revenue, production deployment, or `VERIFIED` runtime evidence
- `evals/` empty; skill fixtures named in the registry are missing; CI does not run registry or graph validation
- Draft PR #3 (AOC Canonical Architecture v1) is `TESTED`, not `VERIFIED`, and is not merged
- Owner fields are the org name `Full-Stack-Assets`; some commits use a personal or student email
- AOC capability records such as CAP-006 client conversion and CAP-013 financial analysis, where they exist on the draft branch, are `DECLARED` with no provider role

An M&A team that hears “ten-division agent operating company” and then opens a v0 registry will walk. The acquirable wedge is narrower:

**A policy-first, runtime-independent control plane for governed agent work.**

Primary pitch, when outreach is later allowed: **tuck-in IP for governed agent execution**, not “buy an operating company.”

The selling object, until the Human Principal records otherwise, is **BuildGraph IP plus founder**, not AOC-as-company.

## 3. Evidence states used in this file

These states are the only allowed claim language in acquisition artifacts. Definitions match the AOC draft vocabulary and apply here even if PR #3 is not merged.

| State | Meaning | May be used in a CIM or buyer brief? |
|---|---|---|
| UNVERIFIED | Claim or artifact exists without sufficient evidence | No |
| DECLARED | Definition or compatibility is documented | Only as a documented gap or planned item |
| TESTED | Repeatable automated or representative tests passed | Yes, within the tested scope, with the test command cited |
| VERIFIED | Independent human acceptance confirmed the claim | Yes, within the verified scope; none on current `main` |
| SUPERSEDED / REVOKED | Replaced or invalidated | No new routing or sale representation |

Rules:

1. `docs/CLAIM_EVIDENCE_LEDGER.md` is the source of truth for what may be said.
2. A connected ClickUp MCP session, mock receipt, archive `COMPLETE` file, or draft PR test run is not `VERIFIED` operational authority.
3. Do not invent an M&A capability, factory, or division in the registry to “find buyers.”
4. CAP-007 contract analysis and CAP-013 financial analysis remain `DECLARED` on the AOC draft. Using them to assert deal advice is a legal-assertion violation under ADR-001.

## 4. Buyer universe to research later

Do not contact anyone until the outreach gates in section 7 pass. The first commercial artifact is this **buyer map**, not emails.

| Buyer type | Why they might acquire this | Why they would pass today | Example desks to research |
|---|---|---|---|
| Platform / Copilot corp-dev | Agent governance, policy, evidence, runtime portability | No production proof, no customers, AOC overclaim risk | Microsoft, GitHub, Google Cloud, AWS |
| Enterprise automation / ITSM | Control plane that sits above agents and tools | No ServiceNow/Salesforce-grade integration evidence | ServiceNow, Salesforce, UiPath, Automation Anywhere |
| Consulting / SI | Reusable operating-model IP for client agent programs | Looks like a prototype repo, not a method product | Accenture, Deloitte, PwC, IBM |
| Security / GRC | Fail-closed authority, approval, audit graph | No SOC 2, pentest, or enterprise IdP | CrowdStrike, Palo Alto, OneTrust-class GRC |
| PE / AI-ops roll-up | Premature; needs revenue or a second product | No ARR | Ignore until there is a customer |

First approach, when allowed, is inbound or a warm introduction, not cold M&A inboxes.

## 5. Confidential data-room index

These items are human-owned. They are not runtime integrations and must not be published. No live ClickUp token, customer invention, revenue figure, or production claim belongs in the room unless the repository can reproduce it.

| ID | Diligence topic | Current internal state | Blocking gap |
|---|---|---|---|
| DR-01 | Legal entity and cap table | GitHub org `Full-Stack-Assets`; owner fields use that name | Confirm Massachusetts or other formation, ownership, contractors, and prior assignments |
| DR-02 | IP chain | Package is `UNLICENSED` (proprietary), which buyers often prefer | Assignment to the selling entity from every contributor, including agent-assisted commits; personal/student emails on git history |
| DR-03 | Product evidence | Registry → router → projection → receipt is tested; graph hash is deterministic | One 15-minute supervised I2 demo path; CI does not yet run registry/graph validation |
| DR-04 | Claim vs evidence ledger | `docs/CLAIM_EVIDENCE_LEDGER.md` | Keep AOC ten-division language out of any CIM until independently `VERIFIED` |
| DR-05 | Security | `SECURITY.md`; fail-closed adapters; no committed tokens in `.env.example` | No SOC 2, pentest, or enterprise IdP; CI omits registry/graph gates |
| DR-06 | Third-party code | npm dependencies `ajv` and `yaml`; ClickUp client uses public API | Record npm licenses in a NOTICE; ClickUp API ToS; do not present archive/prototype code as original |
| DR-07 | Key-person | Single founder | Document what survives without the founder |
| DR-08 | Customers and revenue | None | Do not invent pipeline, ARR, or logos |
| DR-09 | Demo workflow | `WorkflowSpec` schema only | ADR-001 domain decision required; recommended domain is control-plane governance, not finance/M&A execution |

## 6. Human-principal commercial track

Parallel to engineering, owned only by the Human Principal:

1. Confirm the selling object: **BuildGraph IP + founder**, not AOC-as-company.
2. Form or confirm the legal entity that owns the GitHub organization and this repository.
3. Retain counsel before any buyer contact. This repository does not select counsel.
4. Write a 2-page confidential brief: problem (ungoverned agents), wedge (canonical registry + fail-closed adapters + evidence graph), proof (tests, graph hash, CI), ask (tuck-in / acqui-hire). Cite only `TESTED` or `VERIFIED` rows from the claim ledger.
5. Expand the buyer map from section 4. Do not send it.
6. Fill the data-room checklist. No customer, financial, or production claims that the repo cannot reproduce.

## 7. Human-only outreach gates

All of the following must be true before the Human Principal contacts a corp-dev or M&A desk. An agent or worker must not contact them in any event.

1. Counsel retained and entity/IP assignment status known.
2. Unit 16-E unified validation is the command CI and a clone actually run.
3. Unit 17-E evals and named skill fixtures exist, so the registry is not hollow.
4. Proprietary/IP hygiene pack exists: explicit license or proprietary statement, contributor assignment note, dependency NOTICE, and a secret scan result.
5. Claim ledger reviewed; no AOC `DECLARED` capability is phrased as a product feature.
6. One supervised I2 demo can be executed without a production credential.
7. The Human Principal explicitly records that outreach is permitted.

Until then, the only allowed external posture is silence.

## 8. ADR-001 recording for the first demo domain

ADR-001 is not amended. Its deferred decision #1 (first operational domain and pilot workflow) remains open.

**Implementation recording:** if that decision is later made in order to support a 15-minute diligence demo, the domain should be **control-plane governance** (registry validation, routing, projection, receipt, graph hash). It must not be finance, M&A execution, contract signature, payment, or buyer outreach.

## 9. Explicit non-goals

- Agent or worker emailing M&A departments, bankers, or corp-dev
- Valuing the company, drafting a purchase agreement, or giving legal/tax advice
- Public launch, press, marketplace listing, or treating this file as an offering memorandum
- Treating ClickUp MCP, mock receipts, or PR #3 tests as operating proof
- Adding a DIV-11 “M&A” division, buyer-scraping integration, or acquisition capability record
- I3/I4, payments, or production GitHub merge in order to “look bigger”

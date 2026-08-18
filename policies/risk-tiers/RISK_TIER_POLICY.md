# Risk Tier Policy

## Rule

Every role, task, workflow, and requested action is classified as `low`, `moderate`, `high`, or `restricted`. The effective risk tier is the highest tier present across the role, task context, data class, integration target, and requested action.

| Risk tier | Maximum default access | Required behavior |
|---|---|---|
| Low | I2 | Drafts, classification, formatting, internal tags, and bounded reversible artifacts. |
| Moderate | I2 | Evidence-backed recommendations, nonproduction code changes, draft external content, and scoped internal work. |
| High | I2 | Analyze, validate, create evidence, and recommend; named accountable human review is required before any consequential effect. |
| Restricted | I2 preparation only | Prepare records and escalation packets; humans perform or explicitly confirm any external, financial, legal, clinical, identity, employment, safety, or irreversible action. |

## Non-negotiable controls

1. I3 and I4 are disabled during BuildGraph v0.
2. No task may downgrade a role’s risk tier.
3. Missing risk information is treated as `high` until a named policy owner resolves the classification.
4. A runtime may not determine its own effective authority.
5. Every high or restricted result must include explicit risks, uncertainties, evidence references, and required human decision.

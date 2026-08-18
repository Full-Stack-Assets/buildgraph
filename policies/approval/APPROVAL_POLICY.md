# Approval and Separation-of-Duties Policy

## Rule

A BuildGraph role may create a draft, recommendation, evidence package, branch, pull request, or sandbox artifact only within its approved integration tier. A role may not approve, release, publish, merge, deploy, sign, pay, certify, attest to, or otherwise finalize its own consequential output.

## Approval requirements

| Condition | Required state | Required record |
|---|---|---|
| Output needs reviewer evaluation | `NEEDS_REVIEW` | Result envelope with complete provenance and quality evidence |
| Output can move to next internal gate | `APPROVED_FOR_NEXT_GATE` | Independent evaluator or named human review reference |
| Output requests consequential action | `RELEASE_READY` | Approval record with named authority, scope, conditions, expiry, and evidence bundle |
| Evidence, authority, or quality is incomplete | `BLOCKED` | Explicit missing requirement and escalation owner |

## BuildGraph v0 boundary

1. No I4 approval may authorize execution in BuildGraph v0.
2. Approval records are modeled and validated, but execution-capable adapters are deferred.
3. A creator role and evaluator/authorizer role must have distinct role IDs.
4. An expired, revoked, incomplete, or mismatched approval record is invalid.
5. Any request involving payment, refund, contract, legal assertion, identity/permission change, hiring/employment, clinical decision, safety action, protected-branch merge, production deployment, public communication, or destructive action remains human-controlled.

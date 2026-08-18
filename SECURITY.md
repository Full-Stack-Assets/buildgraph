# Security Policy

## Scope

BuildGraph governs role, skill, integration, task, passport, approval, evidence, and runtime-adapter definitions. Security-sensitive changes include any change to authority ceilings, permission tiers, integration scopes, approval policy, data handling, runtime tool access, validation rules, or release controls.

## Reporting

Do not open public issues for suspected credential exposure, authorization bypass, unsafe action path, sensitive-data leakage, schema-validation bypass, or audit-record tampering. Report privately to the repository owner with the affected version, reproduction details, observed behavior, expected behavior, and supporting evidence.

## Security invariants

1. The registry never stores plaintext credentials or tokens.
2. Runtime adapters receive only task-scoped, least-privilege authority references.
3. I4 actions require a valid named human approval record and are never silently executed.
4. Integration authentication, permission, schema, and policy failures fail closed.
5. Agents cannot approve, release, publish, merge, pay, certify, or attest to their own consequential output.
6. Registry changes require validation and owner review.
7. Sensitive content is minimized in logs; references and hashes are preferred where possible.

## Supported versions

Only the latest default-branch version is supported during the v0 foundation phase.

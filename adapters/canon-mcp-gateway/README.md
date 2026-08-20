# CANON MCP Gateway

Provider-neutral, read-first boundary for Gemini, Microsoft Work IQ, Apple domains, and selected iPhone Files.

This package currently contains the recovered contract and policy layer. Provider adapters are intentionally credential-gated and must implement GatewayResult without converting authentication, consent, rate-limit, or reachability failures into NO_RESULTS.

Mutation tools are excluded by construction.

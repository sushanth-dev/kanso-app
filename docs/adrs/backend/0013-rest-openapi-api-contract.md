# 0013. Define the API as REST with an OpenAPI contract

* Status: accepted
* Date: 2026-07-31
* Builds on: [ADR-0007](0007-hono-http-framework.md), [ADR-0008](0008-zod-validation.md)

## Context

The frontend and the API are separate services that need a shared
contract, and the API may gain other clients later (a mobile app, an
integration). The alternatives were tRPC, GraphQL, or REST with an
OpenAPI document.

## Decision

REST, with the OpenAPI document generated from the Zod schemas through
Hono's OpenAPI integration. The schemas from ADR-0008 are the single
source: request validation, TypeScript types, and API documentation all
derive from them, so the contract cannot drift from the implementation.
The frontend consumes the contract through a generated TypeScript client
rather than hand-written fetch calls and hand-maintained response types.

tRPC was rejected because its end-to-end type sharing assumes one
TypeScript project on both ends and a single known client. An OpenAPI
contract outlives the current frontend and works for clients that do not
exist yet. GraphQL was rejected as a second query language and execution
model for an API whose resources are simple and relational.

## Consequences

One build-time code generation step on the frontend, run when the API
changes. The API is documented and typed for any HTTP client, not only
our React app. The cost is the discipline of treating the generated
client as generated: hand-editing it is forbidden, the same rule ADR-0002
sets for token output.

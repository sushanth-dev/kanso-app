# 0008. Validate with Zod

* Status: accepted
* Date: 2026-07-31
* Builds on: [ADR-0007](0007-hono-http-framework.md)

## Context

Every request body, query string, and path parameter crosses a trust
boundary and needs validation before it touches application code, per the
standing rule that input is validated at the boundary. The schema should
also produce the TypeScript types and the OpenAPI documentation, so the
three cannot drift. The alternatives were Zod, Valibot, ArkType, and
hand-written validators.

## Decision

Use Zod 4 (version 4.4 at the time of writing) for all boundary
validation. Schemas live next to the routes that consume them and infer
the TypeScript types, so a route's input type is always its schema.
Through `@hono/zod-openapi`, Hono's OpenAPI extension, the same schemas
feed the OpenAPI document that the frontend client is generated from.

Zod 4 differs enough from version 3 to name here. Error customization
takes a single `error` parameter instead of `message`, string formats are
top-level constructors (`z.email()`, not `z.string().email()`), and
`.refine()` results stay chainable. New code follows the version 4 forms
from the start.

## Consequences

One new runtime dependency, the most integrated validation library in the
TypeScript ecosystem: Hono, Drizzle, and the OpenAPI generators all have
first-class Zod adapters. Hand-written validators are avoided. The cost is
that the schemas are another artifact to keep current, but they replace
three artifacts (validators, types, API docs) with one.

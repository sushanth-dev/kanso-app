# 0009. Access PostgreSQL through Drizzle

* Status: accepted
* Date: 2026-07-31

## Context

The API talks to PostgreSQL, and the access layer decides how schema,
migrations, and queries are written. The standing security rules already
fix two things: parameterized queries only, and integration tests against
a real PostgreSQL rather than mocks. The alternatives were Prisma, Drizzle,
Kysely, and the `pg` driver with hand-written SQL.

## Decision

Use Drizzle ORM (version 0.45 at the time of writing) over the `pg`
driver. The schema is TypeScript code, queries read like the SQL they
generate, and there is no code generation step: the types come from the
schema definition itself. Drizzle also generates Zod schemas from table
definitions, so a row's shape and its validation schema share one source.

Two qualifications come with the pin. Drizzle is still pre-1.0, so minor
releases can carry breaking changes and upgrades get read before they are
applied. And Drizzle is a thin layer: anything past straightforward SQL
(window functions, recursive queries) is written as raw SQL through its
escape hatch, which is a feature here, since the escape hatch is still
parameterized.

## Consequences

One new runtime dependency plus its migration tooling. Prisma's generated
client and engine are avoided: no codegen step in the build, and a query
that looks wrong in review looks like the SQL it runs. The 0.x version is
accepted risk, recorded so nobody treats a minor bump as free. Raw SQL
remains available and reviewable for the queries an ORM shapes badly.

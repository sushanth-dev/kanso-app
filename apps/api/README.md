# API

The backend service. Node 24 LTS and TypeScript against PostgreSQL, served by Hono
(ADR-0007).

There are no request handlers yet. What exists is the two things everything
else is built against, the application shell they will mount on, and the chess
code carried over from the prototype.

```
src/db/schema.ts        the version one database schema, in Drizzle (ADR-0009)
src/db/auth-schema.ts   the one better-auth table our schema references (ADR-0011)
src/contract/schemas.ts the Zod schemas the API speaks in (ADR-0008)
src/contract/routes.ts  the route definitions (ADR-0013)
src/app.ts              the shell: session guard, error and not-found responses
src/chess/              pure chess functions carried over from the prototype
drizzle/                generated migrations, committed
openapi.json            generated contract, committed
```

## Commands

Run from the repository root, not from here.

```sh
npm test                       # the whole suite (ADR-0019)
npm run typecheck              # tsc --noEmit
npm run lint                   # eslint
npm run format                 # prettier --write
npm run openapi                # regenerate openapi.json from the route definitions
npm run db:generate            # regenerate the migration from the schema
```

## The shell

`src/app.ts` holds what every handler inherits and none of them should
restate: which routes refuse to answer without a session, what an unknown path
returns, and what happens to a thrown exception. The session guard reads the
contract's own `security` field to decide which routes are public, so adding a
public route cannot silently miss the list, and it takes a `getSession`
function rather than reaching for better-auth, so it is testable without an
auth provider. Handlers attach with `app.openapi(route, handler)` as stories
land.

`openapi.json` and everything under `drizzle/` are generated. Both are
committed so a reviewer can see what a schema change does to the SQL and what a
schema change does to the contract, and neither is ever hand-edited. That is
the same rule ADR-0002 sets for design token output.

## The schema

Every table names the requirement it serves, using the ids from the business
analysis in the `project` repository. A column that cannot say which
requirement it serves does not belong yet.

The migration in `drizzle/` is generated from `src/db/schema.ts` and committed
alongside it. Every table is created by a checked-in migration starting with
the first one, which is the lesson the prototype paid five months of untracked
schema changes to teach us.

## The contract

`openapi.json` is generated from the route definitions, which are written in
terms of the Zod schemas. Request validation, TypeScript types, and the
document all come from one source, so the contract cannot drift from the
implementation (ADR-0013). The frontend consumes it through a generated client.

Authentication is not in the contract. better-auth mounts its own routes under
`/api/auth/*` and owns their shape (ADR-0011). Everything here assumes a
session cookie and answers 401 without one, except the shared proof sheet,
which is the one route designed to be read by someone with no account.

## The carried-over chess code

`src/chess/` holds four files from the Kanso Chess prototype, described in the
`project` repository's prototype carry-over notes. They are pure functions over
positions, they import nothing but chess.js, and `lichess-utils.ts` in
particular took nineteen commits of correction against real games to reach its
current state. Read the header before simplifying anything in it.

They arrived without tests. `lichess-utils.ts` and `pgn-name-match.ts` now have
them, organised by correction guard rather than by function, for the reasons in
[ADR-0019](../../docs/adrs/backend/0019-vitest-testing-setup.md).
`diagnostic-utils.ts` and `heuristics.ts` are still uncovered and are sprint
work.

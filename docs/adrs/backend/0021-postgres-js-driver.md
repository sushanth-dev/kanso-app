# 0021. Connect to PostgreSQL with postgres.js

* Status: accepted
* Date: 2026-08-04
* Fills a gap left by: [ADR-0009](0009-drizzle-orm.md)

## Context

ADR-0009 chose Drizzle ORM but stopped short of the driver underneath it.
Drizzle builds and types the query; something else has to open the socket,
speak the wire protocol, and hold the connection pool. The repository has
had neither driver installed, so every story that touches data has been
blocked on this, starting with the integration test harness in ST-001.

Drizzle supports both candidates as first-class adapters, so this is not a
choice about which queries we can write. It is a choice about what runs
under them.

`pg` (node-postgres) is the older and more widely deployed of the two. At
8.22.0 it pulls six direct dependencies of its own: `pgpass`, `pg-pool`,
`pg-types`, `pg-protocol`, `pg-cloudflare`, and `pg-connection-string`.

`postgres` (postgres.js) is at 3.4.9 and declares no dependencies at all.
It implements the wire protocol, the pool, and type parsing in one package.

## Decision

Use `postgres` (postgres.js), imported through `drizzle-orm/postgres-js`.

Three reasons, in order of weight.

The dependency surface is one package instead of seven. Our security
policy requires pinned dependencies and an `npm audit` gate in CI, and both
get harder to hold the more transitive packages sit under a direct one.
DEBT-004 already exists because a transitive dependency of `drizzle-kit`
fails `npm audit` permanently and we cannot fix it from here. Six more
packages under the driver is six more chances at the same problem.

Its parameterisation is the default rather than the careful path. A
tagged template interpolates values as bound parameters, so the obvious way
to write a query is the safe one. With `pg`, a `$1` placeholder is equally
safe but a template literal next to it is not, and the difference between
the two is one character. Our security policy mandates parameterised
queries for every database access; a driver where the natural syntax is
already parameterised enforces that better than a review can.

It handles the shape we deploy into. ADR-0014 puts the API and the
analysis workers on Lambda, where a container is frozen between invocations
and connections outlive the request that opened them. postgres.js exposes
`max` and `idle_timeout` directly on the connection, so a Lambda-sized pool
is a configuration value and not a wrapper.

The counter-argument for `pg` is real and does not win: it is older, has
more production-years behind it, and more answers written about it. That
matters most when a driver is doing something unusual, and ours will be
doing exactly what every driver does.

Migrations continue to run through `drizzle-kit`, which is unaffected by
this choice.

## Consequences

`postgres` is added as a dependency of `apps/api` when ST-001 lands, pinned
to an exact version, and not before, because a dependency with nothing
importing it is a dependency nobody is checking.

Two operational details that follow from this record rather than from the
story that applies it. Prepared statements have to be turned off when
connecting through a transaction-mode pooler such as PgBouncer or the
Supabase pooler; the pooler hands a different backend to each statement and
a prepared statement does not survive that. If we ever put one in front of
the database, `prepare: false` goes on the connection at the same time, and
the reason is here rather than in a commit message.

The other is that our error handling has already assumed this. The 500
handler in `apps/api/src/app.ts` returns a fixed message rather than the
error's own, because a driver error routinely carries the query and the
connection string. That was written before a driver was chosen and holds
for either one.

Moving to `pg` later means changing the import and the connection setup in
one place. The queries Drizzle generates do not change, which is most of
what ADR-0009 bought.

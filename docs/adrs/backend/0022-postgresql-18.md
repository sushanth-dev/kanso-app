# 0022. Run PostgreSQL 18

* Status: accepted
* Date: 2026-08-04
* Fills a gap left by: [ADR-0009](0009-drizzle-orm.md), [ADR-0014](0014-aws-hosting-layout.md)
* Related: [ADR-0021](0021-postgres-js-driver.md)

## Context

ADR-0009 chose Drizzle, ADR-0021 chose the driver under it, and ADR-0014 put
the database on a managed RDS instance. None of the three says which major
version of PostgreSQL we run.

That was tolerable while nothing connected. It stops being tolerable in
ST-001, which requires CI to run the integration suite "on the same major
version we intend to run in production" and then admits, in its own notes,
that no version has been chosen. A test suite on a different major version
than production is a gate that lies: `postgres:17` in a CI service container
and PostgreSQL 18 on RDS would agree about almost everything and disagree
about exactly the things a major version changes.

So this has to be a number before the first service container is written,
which is day one of ST-001.

The schema already leans on version-sensitive behaviour. Our uniqueness rules
are partial indexes with `where` clauses (`game_external_unique` is unique
only where `external_id` is not null; one active focus per player is the same
pattern). Those are the constraints ST-001 exists to test, and they are the
kind of thing that should be exercised against the version that will enforce
them in production.

## Decision

PostgreSQL 18, everywhere: the CI service container, the local development
database, and the RDS instance when ADR-0014's hosting layout is built out in
E3.

The reasoning is the same instinct as ADR-0020's choice of a Node LTS line,
adapted to a project that versions differently. PostgreSQL has no LTS
concept; every major release gets five years of community support from its
release date, so the newest major we can actually deploy on is also the one
with the longest runway before a forced upgrade. PostgreSQL 18 was released
in September 2025 and is supported until late 2030. PostgreSQL 17 would put
us a year closer to the same wall for no benefit we can name.

Not PostgreSQL 19. It is expected around September 2026 on the project's
annual cadence, which is a month after this sprint ends, and managed
providers trail an upstream release by months rather than days. Starting on a
version RDS does not yet offer would force CI and production apart on day
one, which is the precise failure this record exists to prevent. When 19 is
available on RDS and has a patch release or two behind it, upgrading is a
decision to make deliberately, and it supersedes this record rather than
happening quietly.

One thing this record asserted and did not verify: that RDS offers PostgreSQL
18 in our region. ST-006 checked it, against the API rather than the release
notes. `aws rds describe-db-engine-versions --engine postgres --engine-version
18 --region ap-south-2` returns `18.1 18.2 18.3 18.4`, and `db.t4g.micro`, the
instance class the deployed database runs on, is orderable on 18.4 in all three
Hyderabad availability zones. The expectation held, so this record stands
unchanged. Had it not, this record would have been revised downward to whatever
RDS does offer with CI moving in the same change, because the two moving
together is the whole point.

The SST `Postgres` component defaults to version 17, so 18 is set explicitly in
`infra/database.ts`. A default left alone would have been the exact drift this
record exists to prevent.

## Consequences

The version is now a fact three places have to agree on, and they will drift
unless the agreement is written down. The CI service container pins
`postgres:18`, `docs/guides/local-setup.md` tells a contributor to run the
same, and the RDS engine version is set to 18 when SST defines it. A change
to any one of the three without the other two is the gate lying again.

`.env.example` carries a `DATABASE_URL` placeholder rather than a value, so
the version a contributor actually runs is decided by the container they
start, not by a string they copy. The local setup guide is where that
container is named.

We accept one cost knowingly. Pinning the major means a major upgrade is
eventually a piece of scheduled work rather than something that never comes
up: a dump-and-restore or a `pg_upgrade`, with the migrations replayed
against the new version first. That work is cheaper to do once every few
years than to discover during an incident because CI and production quietly
diverged.

Minor versions are deliberately not pinned. RDS applies minor patches in a
maintenance window and a CI container tag of `postgres:18` follows the latest
18.x. Minors do not change behaviour we depend on, and pinning them would
mean a repository commit for every security patch.

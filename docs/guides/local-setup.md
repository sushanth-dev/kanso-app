# Local setup

There is no application to run yet. What there is, and what this guide covers,
is the toolchain: the runtime, the dependencies, the database the tests need,
and the gates every change passes before it can be committed.

## Prerequisites

* Node.js 24 LTS. The exact version is in `.node-version` at the repository
  root, and mise, fnm, and nvm all read that file. See
  [ADR-0020](../adrs/backend/0020-node-24-lts-runtime.md) for why the runtime
  is pinned to an LTS line.
* [uv](https://docs.astral.sh/uv/), which runs Semgrep and MkDocs without
  installing either one globally.
* [gitleaks](https://gitleaks.io/), which scans for committed secrets:
  `brew install gitleaks`. The pre-commit hook refuses to run without it
  rather than skipping the check, because a secret scanner that quietly does
  not run is worse than none at all.
* PostgreSQL 18, for the integration tests. Docker or Podman is the easiest
  way to get one; see [The database](#the-database) below.
  [ADR-0022](../adrs/backend/0022-postgresql-18.md) explains why the version
  is pinned and why running a different one locally makes the test suite lie
  to you.

## Install

```sh
npm ci
```

That also runs `npm run prepare`, which points git at `.githooks/` so the
pre-commit and pre-push gates are live. There is no separate setup step and no
hook-runner dependency.

Then copy the environment file:

```sh
cp .env.example .env
```

`.env` is gitignored and must stay that way. It holds a connection string,
which is a credential.

## The database

The integration tests need a real PostgreSQL, because the testing policy in
the `project` repository forbids mocking it. The reason is specific: our
uniqueness rules are partial indexes with `where` clauses, and a stand-in
would happily accept the rows a real database rejects.

Run the same major version CI and production run
([ADR-0022](../adrs/backend/0022-postgresql-18.md)):

```sh
docker run --name kanso-db -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 -d postgres:18
```

Then create the development database:

```sh
docker exec kanso-db createdb -U postgres kanso_dev
```

That matches the `DATABASE_URL` already in `.env.example`. The container is a
throwaway: the integration suite resets state between tests, so never point
`DATABASE_URL` at a database whose contents matter to you.

The suite creates its own randomly-named database on that server and drops it
on the way out, applying the committed migrations itself. `kanso_dev` exists
only as the connection's landing database; the tests never touch its tables.

Migrations are committed in `apps/api/drizzle/` and the test suite applies
them to a fresh database itself. Do not create tables by hand. The prototype
did that for five months and ended up with ten versions of the same function
in `public`, nine of them dead and none documented.

## The queue

Analysis runs off an SQS queue, and the queue tests are not allowed to mock it
either: a malformed batch entry or a wrong queue url is exactly the kind of
mistake a stand-in accepts. LocalStack is a real SQS implementation you can run
on your machine:

```sh
docker run --rm -d -p 4566:4566 --name kanso-localstack \
  -e SERVICES=ses,sqs localstack/localstack:4
```

The tests create and delete their own queues, so nothing needs to be set up
inside it. They need an endpoint and credentials, which LocalStack accepts as
anything at all:

```sh
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
```

`AWS_ENDPOINT_URL` is also the switch: with it unset the queue tests skip
rather than run, because without an endpoint the SDK talks to real AWS with
whatever credentials the machine holds. So the rest of the integration suite
works with no LocalStack, and CI, which does set it, runs them every time.

`ANALYSIS_QUEUE_URL` stays unset locally. Without it the API imports games and
does not queue them, which is the path the rest of the suite runs on, and
analysis can be run by hand against a game id instead.

## The commands

```sh
npm test                # the unit suite: fast, no database needed
npm run test:watch      # the unit suite, re-running on save
npm run test:coverage   # the unit suite with a coverage report
npm run test:integration   # the integration suite, against the database in DATABASE_URL

npm run typecheck       # tsc --noEmit across every workspace
npm run lint            # eslint
npm run format          # prettier --write
npm run format:check    # prettier --check, which is what CI runs

npm run openapi         # regenerate openapi.json from the route definitions
npm run db:generate     # regenerate the migration from the schema
```

## The gates

Lint, format, typecheck, tests, and Semgrep run on every commit through
`.githooks/pre-commit`, and again in CI on every pull request. The local hook
is for fast feedback; CI is the version that counts, because it runs in a clean
environment and cannot be skipped.

`.githooks/pre-push` refuses a direct push to `main`. The branching strategy
in the `project` repository says work reaches `main` by pull request, and
nothing enforced that: branch protection and rulesets both need GitHub Pro on
a private repository, and these repositories are private on a free account.
The hook is worth exactly what a local hook is worth. It runs on your machine,
`--no-verify` skips it, and a clone that never ran `npm ci` does not have it.
It is a reminder with teeth, not a control. If the rule ever matters more than
that, the answer is GitHub Pro rather than a cleverer hook.

If a gate is wrong about a specific line, suppress it inline on that line with
a comment explaining why. Turning a rule off across the project to silence one
warning removes the protection everywhere and is not allowed. The full working
agreement is in the `project` repository under `docs/process/code-quality.md`.

Semgrep runs the `p/default` community ruleset. The narrower `p/typescript`,
`p/security-audit`, and `p/secrets` were tried first and rejected: run against a
file written to fail, containing `eval()`, a hardcoded AWS key, and string-built
SQL, all three together found nothing, while `p/default` found the `eval`. Do
not swap the ruleset without running that check again, because a scanner that
runs and finds nothing looks exactly like a scanner that works.

The gap that leaves is hardcoded credentials, which none of the Semgrep
rulesets detected because its secret detection needs an account. Gitleaks
covers it instead, and needs no account. The hook scans staged content only,
so a secret is caught before the commit exists, which is the difference
between deleting a line and rewriting history. CI scans the whole history,
because the hook cannot see a commit made on a machine that did not have it.

Its rules are in `.gitleaks.toml`. The default set catches credentials with a
recognisable shape and misses a database connection string, which has no
prefix and is the one we actually handle, so there is a rule for it. That rule
allows placeholders and anything pointing at localhost.

Two ways to mark a false positive, and they are not interchangeable. A
`gitleaks:allow` comment on the offending line works for the working copy, and
it has to be on that line rather than the one above. A finding already in a
commit needs its fingerprint in `.gitleaksignore`, because commits do not
change. Neither is the answer for a real credential: a secret that reached a
commit is disclosed, and the response is to rotate it first.

## Still to come

This guide gains a section per piece of infrastructure as it arrives: the
development servers for the backend and the Vite frontend, and the Playwright
setup for end-to-end tests.

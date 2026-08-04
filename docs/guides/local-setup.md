# Local setup

There is no application to run yet. What there is, and what this guide covers,
is the toolchain: the runtime, the dependencies, and the gates every change
passes before it can be committed.

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
* PostgreSQL, once there is code that talks to it. Nothing here needs it yet.

## Install

```sh
npm ci
```

That also runs `npm run prepare`, which points git at `.githooks/` so the
pre-commit gates are live. There is no separate setup step and no hook-runner
dependency.

## The commands

```sh
npm test                # the whole suite
npm run test:watch      # the suite, re-running on save
npm run test:coverage   # the suite with a coverage report

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
`.env.example` file and the local database, the development servers for the
backend and the Vite frontend, and the Playwright setup for end-to-end tests.

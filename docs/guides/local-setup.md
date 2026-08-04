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

One gap this leaves, recorded rather than papered over: none of the rulesets
detected the hardcoded credential, because Semgrep's secret detection needs an
account. Secrets are currently caught by review and by `.gitignore`, not by a
scanner. It is on the product backlog in the `delivery` repository.

## Still to come

This guide gains a section per piece of infrastructure as it arrives: the
`.env.example` file and the local database, the development servers for the
backend and the Vite frontend, and the Playwright setup for end-to-end tests.

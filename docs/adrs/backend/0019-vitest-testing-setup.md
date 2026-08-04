# 0019. Test with Vitest, one runner for the whole workspace

* Status: accepted
* Date: 2026-08-04

## Context

The testing policy in the `project` repository already settles the questions
of principle: tests ship in the same pull request as the code they cover, a
feature without tests does not merge, integration tests run against a real
PostgreSQL rather than a mock, and Vitest is the runner. What it does not
settle is how that is arranged in this repository, and until it is arranged
there is nowhere for a test to go.

The pressure to answer this now comes from the carried-over prototype code
in `apps/api/src/chess/`. Those four files arrived with no tests.
`lichess-utils.ts` in particular is a port of Lichess's `Advice.scala` with
six correction layers stacked on top, each added after a real game produced
a false positive, over nineteen commits and about a month. Every guard is a
small conditional, none of them is self-evidently necessary from reading
the code, and a refactor that removes one produces no crash. It produces a
player being told they blundered when they did not.

The alternatives for the runner were Vitest and Node's built-in
`node:test`. `node:test` carries no dependency at all and is genuinely
capable, which is the argument for it. The argument against is that the
frontend is Vite and React (ADR-0004, ADR-0005), so a Vite-native runner is
arriving in this repository regardless, and running two runners to save one
dependency in the half of the codebase that has fewer tests is a bad trade.
One runner also means one command, one config, and one coverage report
across a workspace that will hold a backend and a frontend.

The alternative for placement was a `tests/` tree mirroring `src/`, against
test files sitting beside the code they cover.

## Decision

Vitest is the runner for the whole workspace, configured once at the
repository root in `vitest.config.mts` and run with `npm test`. Playwright
arrives with the frontend and not before, because there is no end to end to
drive.

Test files sit beside the code they cover, named `*.test.ts`. A test two
directories away from its subject is a test nobody notices is missing, and
the file listing is the coverage report a reviewer actually reads.

Three things follow from the policy and are settled here rather than
per test.

**The carried-over chess code is covered by golden tests organised by
guard.** Each correction layer in the classifier gets a case that trips it
and a case that does not, because a threshold test that only checks one
side of the threshold passes just as happily when the threshold is deleted.
The evaluations in those tests are centipawns from White's absolute
perspective, which is the contract the classifier expects and the
normalization the analysis worker owes it.

**Behaviour a test cannot easily reach gets a seam, not a mock.** The
session guard in `app.ts` takes a `getSession` function rather than reaching
for better-auth, so the guard is testable today without an auth provider,
a database, or a running server. The rule generalises: where a test needs
control over the clock, randomness, or the network, the dependency is
passed in.

**Integration tests connect to a real PostgreSQL through `DATABASE_URL`
and are named `*.integration.test.ts`,** so they can be selected and
excluded as a set. There are none yet, and the runner config gains the
second project when the first one is written rather than before. CI
provides the database as a service container.

Coverage is measured with `@vitest/coverage-v8` and reported in CI as an
artifact. It is measured, not chased.

## Consequences

There is somewhere for a test to go, one command that runs all of them, and
the classifier's correction layers are pinned by tests that say in words
what each guard is for, so the next person to read that file learns why the
guards exist from the test names rather than from archaeology.

The costs are two development dependencies (`vitest` and
`@vitest/coverage-v8`), and the standing burden of golden tests: when a
threshold is deliberately retuned, the test that pinned it has to be
retuned with it, deliberately, in the same commit. That is the point rather
than a side effect, but it does mean a threshold change is never a one-line
diff again.

Test files beside source means `src/` listings are roughly half tests. The
alternative hides the absence of a test, which is worse than a noisy
listing.

The `*.integration.test.ts` naming is a convention with nothing enforcing it
until the first integration test exists. The first story that writes one
adds the runner project and the CI service container, and that story owns
proving the arrangement works.

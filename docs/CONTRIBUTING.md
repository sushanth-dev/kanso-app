# Contributing

This is a personal project and we are not accepting external contributions
yet. These notes record the workflow for the people (and agents) who do work
on it.

## Branches and worktrees

* `main` is the only long-lived branch and is always releasable.
* Every piece of work happens on a short-lived branch named
  `<type>/<short-description>`: `feature/`, `fix/`, `docs/`, or `chore/`.
* Each branch gets its own git worktree, created from an up-to-date `main`.
* Work merges back by pull request only. No direct commits to `main`, no
  force pushes.

## Definition of done

A change is ready for review when all of these hold:

* Tests for the change exist and pass. Vitest for unit and integration tests
  (against a real PostgreSQL, no database mocks), Playwright for end to end.
* ESLint, Prettier, strict TypeScript, and Semgrep are all clean. Analyzer
  warnings block merges.
* The change carries a written security assessment, even if the answer is
  "no new data, no new attack surface, no new risk."

## Committing

Commit early and often on the task branch, and never commit secrets. Use
environment variables locally (`.env`, which is gitignored) and a secrets
manager everywhere else.

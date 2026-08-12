# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## What this repo is

This is the `app` repository: the application code for a chess improvement
app. It is one of several repositories held side by side in a container
folder. The backend (Hono, Drizzle, Zod, chess.js) lives in `apps/api/`.
The frontend has not started yet. Infrastructure is SST on AWS.

`AGENTS.md` is the canonical rulebook for agents in this repo. Read it
before doing any work; this file adds only what it does not already say.

## Git layout

The container folder holds one folder per repository. Each repository keeps
its git history in a `.bare/` directory and checks out branches into
worktrees. This repo is `app/`; its history is in `app/.bare/` and its main
worktree is `app/main/`, where this file lives. Plain `git status` works
inside a worktree but not at the container root.

Work in a worktree, never in `.bare/`. Add a branch like this, from inside
`app/`:

```sh
git --git-dir=.bare fetch origin main
git --git-dir=.bare worktree add feature-xyz -b feature/xyz origin/main
```

Full layout and the rules for working across repositories: `docs/process/`
in the sibling `project` repository. Branch naming: `<type>/<short-description>`
(`feature/`, `fix/`, `docs/`, `chore/`). Rebase onto `main`, merge by PR
only, never commit to `main` directly.

## Commands

```sh
npm install                  # install, wire pre-commit hook
npm run typecheck            # tsc --noEmit, all workspaces
npm run lint                 # eslint, flat config, type-aware
npm test                     # vitest unit tests
npm run test:integration     # vitest integration tests (needs DATABASE_URL)
npm run format               # prettier --write
npm run openapi              # regenerate openapi.json
```

## Quality gates

The pre-commit hook (`.githooks/pre-commit`, wired by `npm install`) runs
Prettier, ESLint, TypeScript, Vitest unit tests, a TODO-with-no-linked-task
check, gitleaks, and Semgrep. A failing gate blocks the commit. CI runs the
same gates in a clean environment. Bypassing with `--no-verify` is not a
workflow. The full policy is in the `project` repository under
`docs/process/code-quality.md`.

## Generated files

Never hand-edit: `openapi.json`, `drizzle/`, `site/`, `.sst/`,
`tokens/build/`. They are committed for review but regenerated from source.

## Stack

Backend: Node.js 24 LTS, TypeScript (strict), PostgreSQL, Hono, Drizzle,
Zod, chess.js. Infrastructure: SST on AWS (ap-south-2). Frontend: Vite,
React 19, TailwindCSS (not started). Do not introduce new languages,
frameworks, or services without an explicit decision from Sushanth.

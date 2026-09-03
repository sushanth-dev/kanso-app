# AGENTS.md

Guidelines for AI agents working in this repository.

## Repository layout

This is the `app` repository: the application code for a chess improvement
app. It is one of several repositories held side by side in a container
folder. Each repository keeps its git history in a `.bare` directory and
checks out branches into worktrees. This repo's history is in `app/.bare/`;
this file lives in the `app/main/` worktree. All real work happens in
worktrees, never in the bare repo itself.

The multi-repo layout and the rules for working across repositories are in
the `project` repository under `docs/process/repository-structure.md`. The
branching model is under `docs/process/branching-strategy.md`, and it is the
same here as everywhere else: one short-lived branch per piece of work,
merged to `main` by pull request.

## What lives here

```
apps/api/          the backend service: Hono, Drizzle, Zod, chess.js
apps/*/src/        application source
docs/              ADRs, guides, contributing, security
tokens/            design token sources (DTCG), consumed by Style Dictionary
.githooks/         pre-commit and pre-push gates, versioned not hidden in .git/
infra/             SST infrastructure definitions (AWS)
sst.config.ts      SST app configuration
```

npm workspaces tie `apps/*` together. `npm install` at the root installs
everything and wires the pre-commit hook via `git config core.hooksPath
.githooks`.

## Before writing code

Work here starts from an approved plan, never from the story alone. The story
in `delivery` carries an `## Implementation plan` section, written when the
story is picked up and approved by Sushanth before the first edit. Approval
shows as the story's `status` reading `in progress`. If the story has no plan
section, write the plan first and wait; do not open an editor in this
repository. The rule is in `project` under
`docs/process/delivery-tracking.md`.

## Sample data

`test-data/` in the container folder, beside `app/`, holds sample PGN files
(`test.pgn` through `test9.pgn`) for exercising the app by hand. It is outside
every worktree and committed to no repository. Use it when a change needs real
game input, rather than inventing PGN inline. It is not a substitute for the
test fixtures that ship with the code.

## Stack

- Node.js 24 LTS, TypeScript (strict), PostgreSQL
- Hono (API framework), Drizzle (ORM), Zod (validation)
- Chess.js (chess logic), Stockfish (analysis, devDependency)
- SST (infrastructure as code, AWS, region ap-south-2)
- Vite, React 19, TailwindCSS (frontend, not yet started)

Do not introduce new languages, frameworks, or services without an explicit
decision from Sushanth.

## Commands

Run from the repository root, never from inside `apps/api/`.

```sh
npm install                  # install everything, wire pre-commit hook
npm run typecheck            # tsc --noEmit across all workspaces
npm run lint                 # eslint (flat config, type-aware)
npm run format               # prettier --write .
npm run format:check         # prettier --check .
npm test                     # vitest unit tests
npm run test:integration     # vitest integration tests (needs DATABASE_URL)
npm run test:watch           # vitest unit tests in watch mode
npm run test:coverage        # vitest unit tests with coverage
npm run openapi              # regenerate openapi.json from route definitions
```

## Quality gates

Every change passes the same checks, whether a human or an agent wrote it.
The pre-commit hook runs all of these automatically; CI runs them again in a
clean environment. A failing gate blocks the merge. The working agreement is
in the `project` repository under `docs/process/code-quality.md`.

1. **Prettier** — formatting. `npm run format:check`
2. **ESLint** — flat config in `eslint.config.mjs`, type-aware rules. Any
   warning blocks merge. A suppression is inline on the line it applies to,
   never a rule turned off across the project.
3. **TypeScript** — strict mode. `npm run typecheck`
4. **Vitest** — unit tests (no database) and integration tests (real
   PostgreSQL, no mocks). `npm test` and `npm run test:integration`
5. **Semgrep** — `p/default` ruleset. Run by the pre-commit hook via `uvx`.
6. **gitleaks** — committed secrets detection. Run by the pre-commit hook.
7. **TODO check** — a TODO or FIXME with no linked story or backlog item is
   rejected. Link with `#NNN`, `ST-NNN`, or `stories/`.

Bypassing the hook with `--no-verify` is not a workflow. If a gate is wrong,
fix the gate.

## Generated files

Never hand-edit these. They are committed so a reviewer can see what a
schema or contract change does, but they are regenerated from source.

- `apps/api/openapi.json` — from route definitions. Regenerate with
  `npm run openapi`.
- `apps/api/drizzle/` — from `src/db/schema.ts`. Regenerate with
  `npm run db:generate` (run from `apps/api/`).
- `site/` — MkDocs build output. Gitignored.
- `.sst/` — SST generated types. Gitignored.
- `tokens/build/` — Style Dictionary output. Gitignored.

## Testing policy

The full policy is in the `project` repository under
`docs/process/testing.md`. Key points:

- Tests ship in the same PR as the code they cover. A feature without tests
  does not merge.
- Unit tests (`*.test.ts`) never touch a database. They must stay fast
  because the pre-commit hook runs them.
- Integration tests (`*.integration.test.ts`) connect to a real PostgreSQL
  via `DATABASE_URL`. No database mocks.
- Determinism is a rule. Tests that read the wall clock must use
  `vi.useFakeTimers()` with the configured `toFake` list in
  `vitest.config.mts`.

## Security

Every story and task carries a written security assessment, even if the
answer is "no new risk." The four questions are in the `project` repository
under `docs/process/security.md`. Never commit secrets. Parameterized
queries only. Validate all input at the boundary.

## Architecture

Architecture decisions are ADRs under `docs/adrs/` (`backend/` and
`frontend/`), indexed at `docs/adrs/index.md`. Read the index before
introducing a new pattern; a decision that contradicts an ADR without
updating it is a bug.

The API request path: `contract/routes.ts` (the route and OpenAPI, ADR-0013)
to `contract/schemas.ts` (Zod validation) to a per-domain handler
(`account/`, `games/`, `import/`, `analysis/`, `tournaments/`, `openings/`)
mounted in `app.ts` via `app.openapi(route, handler)` to `db/schema.ts`
(Drizzle). Cross-cutting concerns (error shape, session, 404) live in
`app.ts`, not in every handler.

## Frontend visual work

Changing what a screen in `apps/web` looks like goes through the Impeccable
plugin, per ADR-0031. Read `PRODUCT.md` and `DESIGN.md` at the repository root
first, critique and audit the surface before editing it, refine rather than
redesign, and update `DESIGN.md` from what shipped in the same pull request.
Replacing the visual world rather than refining it is Sushanth's decision and
its own story. The plugin exempts nothing: every visual decision still resolves
to a semantic token, primitives still come from Astryx, and the WCAG 2.2 AA
floor still binds. A change that alters no visual decision, such as routing or
data fetching, is outside this.

## TypeScript strictness

`strict: true` and `noUncheckedIndexedAccess: true` are enforced and gate
every change. No `any`, no `@ts-ignore`, no cast that silences a real error,
without explicit approval.

## Error handling

Every error the API emits uses the `ApiError` envelope in
`contract/schemas.ts`: `code` (a machine-readable string such as
`no_session`, `forbidden`, or `validation_failed`), `message` (user-facing),
and `issues` (field paths, validation errors only). Handlers return it with
`c.json({ code, message }, status)`. Do not invent a second error shape.

Fail early and fail loud. No empty `catch` blocks, no swallowed errors, no
`console.log` standing in for error handling. A handler that cannot name the
failure lets it surface rather than hiding it.

## Performance

Filter, sort, and paginate in the database, never in the application layer.
`games/list-games.ts` is the reference: the `where()` narrows on `player_id`
and the optional filters before any row is read, `orderBy()` sorts in SQL, and
`limit()/offset()` page in SQL with a separate `count(*)` for the total.
Loading broad and filtering in JavaScript is a bug, not a style choice.

For any query over a table expected to grow (games, tournaments, analysis),
verify the filter columns are indexed and check the plan with `EXPLAIN
ANALYZE` before merging. No response-time budget is set yet; the p95 target is
a decision for Sushanth, not a number the agent invents.

## Git layout

Work in a worktree, never in `.bare/`. Add a branch from inside `app/`:

```sh
git --git-dir=.bare fetch origin main
git --git-dir=.bare worktree add feature-xyz -b feature/xyz origin/main
```

Branch naming: `<type>/<short-description>` (`feature/`, `fix/`, `docs/`,
`chore/`). Rebase onto `main`, merge by PR only, never commit to `main`
directly. The pre-push hook refuses a direct push to `main`.

## Writing

Follow the writing style in the `project` repository
(`docs/writing-style.md`). Key points:

- Write in Sushanth's voice. Use "we", "our", "us". Never address him as
  "you".
- Sentence case for headings.
- No emojis, no em dashes.
- Documents stand alone. Do not reference the conversation that produced
  them.
- Distinguish established decisions from open questions.
- Make the smallest useful addition. Do not pad.

## Commit and review etiquette

- Commit early and often, on the task's branch, inside its worktree.
- Never commit secrets or credentials.
- Do not force push, amend published commits, or skip hooks unless Sushanth
  explicitly asks.
- Watch every merge to green: `gh pr checks <PR> --watch` exits clean
  before `gh pr merge` runs. kanso-app#151 merged over a failing
  integration check; the watch is how it stays a one-off.

# Chess improvement app

An app that helps chess players improve at the game. Players train, coaches
assign and review work, and parents follow along.

The project is in its earliest stage. This repository holds the architecture
decisions, the design tokens, and the first of the application code: the
database schema and the API contract, in [apps/api](apps/api/README.md).

## Tech stack

* Backend: Node.js 24 LTS, TypeScript, PostgreSQL
* Frontend: Vite, React 19, Chess.js, TailwindCSS
* Cloud: AWS

## Repository layout

```
apps/api/     the backend service: database schema, API contract, chess code
docs/         architecture decision records, guides, contributing, security
tokens/       design token sources (DTCG), consumed by Style Dictionary
.githooks/    the pre-commit gates, versioned rather than hidden in .git/
```

npm workspaces tie `apps/*` together. `npm install` at the root installs
everything and wires the pre-commit hook; `npm run typecheck` and `npm test`
run across every workspace.

## Quality gates

Every change passes the same checks, whether a human or an agent wrote it.
Prettier for formatting, ESLint with type-aware rules, TypeScript in strict
mode, Vitest for tests, Semgrep for static analysis, gitleaks for committed
secrets, and `npm audit` for dependencies. They run locally on every commit
through `.githooks/pre-commit`
and again in CI, which is the version that counts. A failing gate blocks the
merge. See [docs/guides/local-setup.md](docs/guides/local-setup.md) for the
commands and the `project` repository for the working agreements behind them.

Git history lives in a bare repository outside this working tree, and all
work happens in git worktrees, one per branch. See
[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for the workflow.

## Documentation

All documentation lives under [docs/](docs/index.md): architecture
decision records, developer guides, contributing notes, and the security
policy. It
reads fine as plain markdown, and MkDocs with the Material theme serves it as
a site:

```sh
uvx --with mkdocs-material mkdocs serve   # live reload at http://127.0.0.1:8000
```

## License

[MIT](LICENSE)

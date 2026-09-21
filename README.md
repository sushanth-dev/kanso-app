# Kanso Chess

An AI training platform for junior chess players and the coaches who teach
them. A player imports the games from a tournament and gets a ranked diagnosis
of what cost them rating, in plain language, starting with the one thing to
fix. They work on that one thing, import the next tournament, and find out
whether it helped. The tournament is the unit of work, not a filter on a stream
of online games: it has a name, a date, a section and five to nine classical
games, which is how a junior, a coach and a parent already think about a season.

The app is live at [kansochess.app](https://kansochess.app).

## How it works

Stockfish evaluates every move of every imported game. The weaknesses that come
out of that are ranked by how much rating each one is costing, and an LLM writes
the explanation behind each one rather than filling in a template. The result
is a diagnosis a player can act on without a coach in the room, and a proof
sheet they can hand to the parent who pays for it.

Games arrive without typing: import from Chess.com or Lichess by username, or
upload a tournament PGN. The first diagnosis is free.

## Repository layout

```
apps/api/         the backend service: database schema, API contract, chess and engine code
apps/web/         the React front end, including the landing page and the marketing routes
apps/extension/   a browser extension that shows a player's active patterns before a game
infra/            the SST infrastructure: API, database, analysis, web, nudge, domains
tokens/           design token sources (DTCG), compiled by Style Dictionary into CSS and TS
docs/             architecture decision records, guides, contributing, security
.githooks/        the pre-commit and pre-push gates, versioned rather than hidden in .git/
```

npm workspaces tie `apps/*` together. `npm install` at the root installs
everything and wires the hooks.

## Running it locally

Prerequisites: Node.js 24 (the exact version is in `.node-version`), PostgreSQL
18, [uv](https://docs.astral.sh/uv/) for the MkDocs and Semgrep wrappers, and
[gitleaks](https://gitleaks.io/) (`brew install gitleaks`), which the pre-commit
hook requires. Docker or Podman is the easiest way to get the database.

```sh
npm ci                     # installs every workspace and sets core.hooksPath
cp .env.example .env       # gitignored; it holds a connection string, which is a credential
```

Start a database and migrate it. `DATABASE_URL` in `.env.example` points at
`localhost:5433`; if PostgreSQL is already running on 5432, change the port in
`.env` instead of starting a second one.

```sh
docker run --name kanso-db -e POSTGRES_PASSWORD=postgres -p 5433:5432 -d postgres:18
docker exec kanso-db createdb -U postgres kanso_dev
npm run db:migrate --workspace apps/api
```

Then the API and the web app, in two shells:

```sh
npm run start --workspace apps/api   # http://localhost:3000
npm run dev --workspace apps/web     # Vite dev server
```

The API reads `.env` itself, so nothing needs exporting by hand.
[docs/guides/local-setup.md](docs/guides/local-setup.md) covers the rest: the
SQS queue that analysis runs off, how the integration suite gets a database, and
why the queue tests skip unless `AWS_ENDPOINT_URL` points at a local SQS.

## Checks

Every change passes the same gates, whether a human or an agent wrote it:
Prettier, ESLint with type-aware rules, TypeScript in strict mode, Vitest,
Semgrep, gitleaks and `npm audit`. They run on every commit through
`.githooks/pre-commit` and again in CI, which is the version that counts.

```sh
npm run typecheck           # every workspace
npm test                    # unit and web projects
npm run test:integration    # needs the database above
npm run test:e2e            # Playwright, in apps/web
npm run lint
```

## Architecture

The application runs on AWS in `ap-south-2`, described in SST v3
([sst.config.ts](sst.config.ts)). The production stage is retained and
protected; every other stage is removed with the app.

- **API** is a Hono app ([apps/api](apps/api/README.md)) deployed as one Lambda
  behind an API Gateway HTTP API, inside a VPC. The OpenAPI document is emitted
  from the same zod schemas the handlers validate with, so the contract cannot
  drift from the code.
- **Database** is PostgreSQL 18 on `sst.aws.Postgres`, reached only from inside
  the VPC. Schema and migrations are Drizzle, committed under
  `apps/api/drizzle/`. Migrations run as their own Lambda, not on API start.
- **Analysis** is an SQS queue with a dead-letter queue and three attempts. The
  worker is an arm64 Lambda container image carrying a Stockfish build compiled
  at image build time, pulled from a shared ECR repository tagged by commit.
- **Web** is a static site on Cloudflare, with the API on the same registrable
  domain so session cookies need no cross-site exception.
- **Nudge** is a second queue and function that sends the post-tournament
  prompt once results land.

The decisions behind that shape, and the ones we reversed, are written down in
[docs/adrs](docs/adrs/index.md): 28 backend records and 18 front end records.

## Documentation

All documentation lives under [docs/](docs/index.md). It reads fine as plain
markdown, and MkDocs with the Material theme serves it as a site:

```sh
uvx --with mkdocs-material mkdocs serve   # live reload at http://127.0.0.1:8000
```

[CONTRIBUTING.md](docs/CONTRIBUTING.md) covers the workflow, which runs on git
worktrees rather than branches in the working tree,
and [SECURITY.md](docs/SECURITY.md) says how to report a vulnerability.

## Licence

MIT, in [LICENSE](LICENSE), for our code. That licence does not cover everything
the app ships: the bundled fonts are OFL-1.1, the icon set is CC BY 4.0, GSAP is
under its own licence, and Stockfish and chessops are GPL-3.0.
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) records each one and what its
licence asks of us.

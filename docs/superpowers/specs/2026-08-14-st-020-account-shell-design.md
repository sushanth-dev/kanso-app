# ST-020 account shell design

## Goal

Add the first browser surface for the existing account API: sign-up, sign-in, sign-out, the signed-in account, owned and guarded players, player creation and editing, and guardian attachment. The result is a locally runnable and production-buildable `apps/web` workspace. AWS hosting is outside ST-020.

## Scope

In scope:

- Vite, React 19, strict TypeScript, Tailwind CSS 4, Style Dictionary, Astryx, TanStack Router, and TanStack Query.
- Generated OpenAPI types and a typed REST client.
- Better Auth browser flows using the real handler and httpOnly session cookie.
- Responsive account routes that meet WCAG 2.2 AA.
- Vitest rendering and data-path tests plus one Playwright journey against the real API, PostgreSQL, and LocalStack SES.

Out of scope:

- AWS hosting or deployment.
- Report, focus, diagnosis, game, tournament, board, and training screens.
- Theme selection, offline behavior, analytics, tables, and virtualized lists.
- TanStack Table, TanStack Virtual, D3, and chess.js usage before a screen needs them.

## Architecture

Create `apps/web` as one npm workspace. Vite serves React 19 and TanStack Router owns the browser routes. Style Dictionary reads the existing DTCG sources under `tokens/` and generates gitignored CSS, TypeScript, and JSON outputs before development, tests, typecheck, or build. Tailwind CSS 4 consumes the generated semantic CSS; components do not use primitive tokens or hardcoded visual values.

Run `openapi-typescript` against `apps/api/openapi.json` and write a gitignored type file under `apps/web/src/generated/`. `openapi-fetch` is the only transport for OpenAPI REST operations. Small TanStack Query functions wrap `GET /me`, `POST /players`, `PATCH /players/{playerId}`, and `POST /players/{playerId}/guardians`. Better Auth's React client owns sign-up, sign-in, and sign-out because Better Auth intentionally owns those routes outside OpenAPI.

Use same-origin URLs in browser code. During local development, Vite proxies `/api`, `/me`, and `/players` to the API on port 3000. The browser never reads a token and needs no CORS policy. A later hosting design must preserve this path routing or explicitly define a separate API origin.

The account query uses the key `['me']`. Player and guardian mutations invalidate it. Sign-out removes account data from the query cache and routes to sign-in. A 401 from the account query routes to sign-in; other failures remain visible on the current route.

## Routes and screens

The visual direction is the Study Room light theme: warm paper page surfaces, raised account cards, Source Serif headings, Public Sans controls, and one terracotta action accent. Layout starts as one column and may become a restrained two-column account layout when space allows. ST-020 adds no dashboard chrome, decorative motion, or theme switch.

- `/sign-up`: name, email, password, password confirmation, field errors, and a sign-in link. Success routes to `/account`.
- `/sign-in`: email, password, a generic authentication or rate-limit error, and a sign-up link. Success routes to `/account`.
- `/account`: account name, email, tier, sign-out, separate owned and guarded player lists, and useful empty states.
- `/account/players/new`: create an owned player.
- `/account/players/$playerId/edit`: edit an owned player.
- `/account/players/$playerId/guardian`: attach a guardian to an owned player.

Separate player routes avoid cramped phone dialogs and preserve normal browser back behavior. Guarded players are read-only.

Player forms send only `displayName`, `birthYear`, federation IDs and ratings, and site usernames. Owner, consent state, generated site ratings, IDs, and timestamps never appear as editable controls. The guardian form sends only guardian email and optional relationship.

Use Astryx for the primitives it supplies, native input types for browser semantics and mobile keyboards, and semantic token utilities for appearance. Where Astryx has no matching primitive, use native semantic HTML rather than building a second primitive layer. Controls have persistent labels, linked hints and errors, visible focus, and comfortable 44 CSS pixel primary targets.

## Errors and security

Credentials and sessions stay inside Better Auth and the httpOnly cookie. Browser code does not read, persist, or log tokens, credentials, or session values. Form-to-request mapping is explicit rather than serializing a form object wholesale, which prevents owner or consent fields from entering player requests.

React renders all API and user strings as text. No raw HTML path is introduced.

OpenAPI 400 issues map to their named fields. A 401 routes to sign-in, a 403 presents a non-enumerating refusal, a 429 asks the person to retry later, and unexpected or network failures show a page-level error with retry. Authentication messages do not reveal whether an email account exists.

Submitting forms disable repeated submission and retain entered values after failure. Successful mutations announce completion through an `aria-live` status, invalidate `['me']`, and return to `/account`. A route-level fallback prevents rendering or query setup failures from leaving a blank page.

## Accessibility

Each route has one clear heading and landmark structure. Inputs use persistent labels, suitable `autocomplete`, native email or number semantics, and error text associated with `aria-describedby`. Status and error announcements use appropriate live regions. Meaning uses labels, icons, or borders in addition to color.

Verification covers keyboard-only completion, a 320 CSS pixel phone viewport, 200 percent text zoom, WCAG AA contrast, reduced motion, and axe results. The layout allows text expansion without fixed-height clipping.

## Tests

The first commit is a gate-clean shell: workspace configuration, approved dependencies, generation, Vite and Tailwind setup, strict TypeScript, root scripts, and one rendered shell. Root format, lint, typecheck, unit tests, and production build pass before account screens are added.

Vitest and Testing Library cover:

- unauthenticated routing;
- owned versus guarded player rendering;
- successful create, edit, and guardian mutations;
- contract error display;
- account-query invalidation;
- the invariant that player requests contain no owner field.

Controlled fetch responses keep frontend rendering tests fast and deterministic. They do not replace end-to-end proof.

One Playwright journey runs Vite and the actual Hono API against PostgreSQL 18 and LocalStack SES. At a phone viewport it signs up, creates and edits a player, attaches a guardian, signs out, signs back in, and verifies the account lists. Axe and keyboard checks run on the rendered routes. Playwright belongs in the existing CI integration job, which already owns PostgreSQL and LocalStack; the job migrates its throwaway database before starting the API.

Final verification runs generation, format check, lint, strict typecheck, unit coverage, integration tests, Playwright, production build, Semgrep, dependency audit, and manual browser inspection at phone and desktop widths.

## Delivery sequence

1. Commit the gate-clean web workspace before adding account screens.
2. Add the generated client, Better Auth client, Query integration, and their tests.
3. Add the approved routes and forms with rendering tests.
4. Add the real Playwright journey and CI integration.
5. Run final gates and browser verification.

Delivery story and sprint status files remain unchanged until the app change merges, matching the sprint's done-in-one-place rule. Pushing and opening a pull request require a separate request.

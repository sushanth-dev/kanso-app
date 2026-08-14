# ST-020 final review fix report

## Status

Complete. All four Important findings and six Minor/ledger gaps from the final branch review are addressed without new dependencies, APIs, routes, storage, hosting, generated-file edits, owner fields, raw HTML, or compatibility code.

Commit subject: `fix(web): close final account shell gaps`

## Changes

### Navigable account journey

- Added reciprocal TanStack Router links between sign-in and sign-up.
- Added a 44-pixel-minimum `Create player` link in the owned-player section, including its empty state.
- Changed the real browser journey to enter at `/sign-in`, keyboard-activate both `Sign up` links, and keyboard-activate `Create player`. The journey no longer navigates directly to sign-up or player creation.
- Restricted intercepted browser HTTP traffic to the Vite origin. Direct API-origin browser traffic is now rejected.

### Session boundaries

- Inspected Better Auth sign-out's installed `BetterFetchResponse.error` channel. A resolved HTTP error now throws into the existing screen handler, keeps the current account page and `ME_QUERY_KEY` cache, and renders exactly `Sign out failed.`
- Kept successful sign-out ordering: Better Auth success, cache removal, then sign-in navigation.
- Removed `ME_QUERY_KEY` before successful sign-in/sign-up navigation to `/account`.
- Removed `ME_QUERY_KEY` before every player/guardian mutation 401 redirect.

### Guardian contract feedback

- Mapped only status-400 `guardianEmail` and `relationship` issues to Astryx `Field.status` using the installed `FieldStatusInput` type.
- Added matching status IDs, `aria-invalid`, and `aria-describedby` values.
- Moved the consent explanation into Astryx `Field.description` with `descriptionID="guardianEmail-consent"`, so the email input has the hint as its accessible description and retains the status association when invalid.
- Preserved both uncontrolled values after failures. Unknown issue paths remain behind generic page copy.

### Ledger gaps

- Account-client test now asserts the exact request origin equals `window.location.origin` and the path equals `/me`.
- Sign-up tests cover required/type/min/max/autocomplete attributes and resolved 401/429 failures.
- Sign-out cache proof seeds `ME_QUERY_KEY`, calls through the real `removeQueries`, and asserts absence.
- Edit links now have `min-h-11 min-w-11` and centered content.
- Registered the concrete TanStack app router and read required params from their owning route paths instead of `strict: false` optional params.
- Player 400 regression now asserts `birthYear` remains `2013`.

## RED evidence

Command:

```text
npx vitest run --project web \
  apps/web/src/routes/auth-routes.test.tsx \
  apps/web/src/routes/account-route.test.tsx \
  apps/web/src/routes/guardian-route.test.tsx \
  apps/web/src/routes/player-routes.test.tsx \
  apps/web/src/router.test.tsx \
  apps/web/src/api/account-api.test.tsx
```

Result before production fixes:

```text
Test Files  5 failed | 1 passed (6)
12 failed tests
exit 1
```

The failures proved the missing reciprocal/create links, stale sign-in/sign-up and mutation-401 account caches, ignored resolved sign-out errors, absent guardian consent association and field mapping, exact sign-out copy, and Edit target width.

The first real-browser rerun also failed after replacing direct navigation because the old test expected a fresh-document skip-link focus sequence after an SPA link transition. The journey was corrected to focus the discovered TanStack links and activate them with Enter, then continue the form by keyboard. No product focus workaround was added.

## GREEN evidence

### Focused regressions

Same focused Vitest command after the fixes:

```text
Test Files  6 passed (6)
Tests       55 passed (55)
exit 0
```

### Typecheck

```text
npm run typecheck --workspace apps/web
> tsc -b
exit 0
```

### Affected lint

```text
npx eslint \
  apps/web/src/routes/auth-routes.tsx \
  apps/web/src/routes/auth-routes.test.tsx \
  apps/web/src/routes/account-route.tsx \
  apps/web/src/routes/account-route.test.tsx \
  apps/web/src/routes/guardian-route.tsx \
  apps/web/src/routes/guardian-route.test.tsx \
  apps/web/src/routes/player-routes.tsx \
  apps/web/src/routes/player-routes.test.tsx \
  apps/web/src/router.tsx \
  apps/web/src/router.test.tsx \
  apps/web/src/api/account-api.test.tsx \
  apps/web/e2e/account.spec.ts
exit 0, no findings
```

### Local real-service prerequisites

Existing PostgreSQL 18 on port 5433 and LocalStack 4 on port 4566 were reused. No resource was provisioned.

```text
npm run db:migrate --workspace apps/api
Migrations applied.
exit 0

KEEP_SES_IDENTITY=1 npx vitest run --project integration \
  apps/api/src/account/mailer.integration.test.ts
Test Files  1 passed (1)
Tests       2 passed (2)
exit 0
```

Environment values were supplied only to the local process and are not recorded or committed.

### Real Playwright journey

```text
npm run test:e2e
Running 1 test using 1 worker
1 passed (12.4s)
exit 0
```

Observed behavior: sign-up and player creation are discovered through visible UI links and activated by keyboard; the real Better Auth cookie survives reload; Mina is created and edited in PostgreSQL; the guardian request returns 204 through Hono and LocalStack SES; sign-out/sign-in restores Mina; axe reports no violations at each checkpoint; browser traffic remains on the Vite origin; no failed request or console error is collected.

### Production build

```text
npm run build --workspace apps/web
> npm run generate && tsc -b && vite build
✓ built in 386ms
exit 0
```

Vite emitted the pre-existing greater-than-500-kB chunk advisory. The real browser web server emitted the pre-existing Astryx runtime-theme performance warning. Neither is introduced by this fix or a browser console error collected by the journey.

### Diff hygiene

```text
git diff --check
exit 0
```

## Files

- `apps/web/e2e/account.spec.ts`
- `apps/web/src/api/account-api.test.tsx`
- `apps/web/src/router.test.tsx`
- `apps/web/src/router.tsx`
- `apps/web/src/routes/account-route.test.tsx`
- `apps/web/src/routes/account-route.tsx`
- `apps/web/src/routes/auth-routes.test.tsx`
- `apps/web/src/routes/auth-routes.tsx`
- `apps/web/src/routes/guardian-route.test.tsx`
- `apps/web/src/routes/guardian-route.tsx`
- `apps/web/src/routes/player-routes.test.tsx`
- `apps/web/src/routes/player-routes.tsx`
- `.superpowers/sdd/final-fix-report.md`

## Self-review

- Better Auth owns all authentication calls; generated OpenAPI transport remains the only account/player transport.
- Cache removal occurs only after confirmed sign-out success and before every required authentication transition. Sign-out errors cannot erase account data or navigate away.
- Guardian issue mapping allowlists only the two named public fields. Unknown API details are not rendered.
- Request bodies remain fixed allowlists and contain no owner or consent fields.
- All links are semantic TanStack links; no imperative route shim or direct product URL was added.
- Router registration restores route-owned param types instead of adding casts or optional fallbacks.
- Existing Study Room semantic classes, Astryx primitives, same-origin proxy, CI action pins, and real E2E boundaries are preserved.
- The diff contains no dependency, generated contract, API, database, infrastructure, workflow, or delivery-story change.

## Concerns

No blocking concern. Existing Astryx runtime-theme and Vite chunk-size performance warnings remain unchanged and are outside this final-review fix.

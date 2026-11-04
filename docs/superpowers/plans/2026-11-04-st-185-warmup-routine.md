# ST-185 Pre-Tournament 5-Puzzle Warm-Up Routine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a fast, confidence-building 5-puzzle tactical warm-up routine on the pre-tournament briefing/tournament detail surface, targeted to the player's active focus or top tactical leak motif.

**Architecture:** Add `assembleWarmup` helper in `apps/api/src/practice/assemble.ts` selecting 5 puzzles banded at `[rating - 300, rating]`. Mount authenticated route `POST /practice/warmup` in `contract/routes.ts` and `apps/api/src/practice/warmup.ts`. In `apps/web`, add a Warm-Up Card on the tournament detail page (`/tournaments/$tournamentId`) and briefing surfaces with a 5-step warmup drill screen in `apps/web/src/routes/practice-route.tsx` displaying the 1-of-5 through 5-of-5 counter and completion badge updating the daily streak.

**Tech Stack:** TypeScript, Node 24, Hono, Drizzle ORM, PostgreSQL, TanStack Router & Query, Astryx primitives, Vitest.

**Spec:** `delivery/main/stories/ST-185-pre-tournament-warmup-routine.md`

## Global Constraints

- Strict TypeScript types; no `any` to bypass type safety.
- Parameterized queries only; no raw string interpolation in SQL.
- Zero database schema migrations: reuse existing `puzzle_attempt` table without changing schema definitions.
- Warm-up puzzle rating band: confident range `[rating - 300, rating]` to build pattern activation without mental fatigue.
- Exactly 5 puzzles dealt per session (`WARMUP_SIZE = 5`).
- Warmup solves do not advance the long-term spaced-repetition ladder (`reviewLevel` remains 0) to avoid scheduling distortion.

## Review Focus

1. Player has no active focus configured: falls back to top mistake motif or default tactical motif (`hanging_piece` / `fork`), never throws 500.
2. Pool has fewer than 5 puzzles in `[rating - 300, rating]`: expands band gracefully up to `[rating - 400, rating + 100]` so 5 puzzles always deal.
3. Warmup attempt does not distort SRS review ladder: persists attempt with `reviewLevel: 0` so standard practice queue is preserved.
4. Abandoned warmup session: pending unattempted rows do not starve general drill pool.
5. Daily streak update: completing the 5th warmup puzzle records activity and increments `player.streak_days`.

---

### Task 1: API Contract and Route Definition for Warmup

**Files:**
- Modify: `apps/api/src/contract/schemas.ts`
- Modify: `apps/api/src/contract/routes.ts`
- Output: `apps/web/src/generated/api.ts` (via `pnpm run generate`)

**Interfaces:**
- Consumes: `WeaknessKind`, `Stream`, `PracticePuzzle` from `apps/api/src/contract/schemas.ts`
- Produces: `PostWarmup` schema, `WarmupSet` schema, `postWarmup` route definition in `contract/routes.ts`

- [ ] **Step 1: Write schemas and route contract in `contract/schemas.ts` and `contract/routes.ts`**

Define `PostWarmup`:
```typescript
export const PostWarmup = z
  .object({
    tournamentId: z.string().uuid().optional(),
    stream: Stream.optional(),
  })
  .openapi('PostWarmup');

export const WarmupSet = z
  .object({
    kind: WeaknessKind,
    group: z.string(),
    theme: z.string(),
    rating: z.number().int(),
    puzzles: z.array(PracticePuzzle).min(1).max(5),
    focusTitle: z.string().nullable(),
  })
  .openapi('WarmupSet');
```

Define route `postWarmup`:
```typescript
export const postWarmup = createRoute({
  method: 'post',
  path: '/practice/warmup',
  tags: ['Practice'],
  summary: 'Deal a 5-puzzle warm-up routine for pre-tournament activation',
  description:
    'ST-185. Deals 5 puzzles banded at [rating - 300, rating] targeted to the player’s active focus or top leak motif before tournament play.',
  request: {
    body: json(PostWarmup, 'Tournament and stream parameters for the warm-up.'),
  },
  responses: {
    200: json(WarmupSet, 'The assembled 5-puzzle warm-up set.'),
    401: json(UnauthorizedError, 'Authentication required.'),
    422: json(InvalidStateError, 'No puzzles available in the pool.'),
  },
});
```

- [ ] **Step 2: Generate OpenAPI TypeScript definitions**

Run: `cd app/feature-st-185 && pnpm run generate`
Expected: `apps/web/src/generated/api.ts` regenerated with `postWarmup` and `WarmupSet`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/contract/schemas.ts apps/api/src/contract/routes.ts apps/web/src/generated/api.ts
git commit -m "contract: define POST /practice/warmup route and WarmupSet schema (ST-185)"
```

---

### Task 2: Backend Warmup Assembly Engine and Route Handler

**Files:**
- Modify: `apps/api/src/practice/assemble.ts`
- Create: `apps/api/src/practice/warmup.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/practice/warmup.integration.test.ts`

**Interfaces:**
- Consumes: `assembleWarmup` helper, `postWarmup` contract
- Produces: `POST /practice/warmup` HTTP handler mounted on `app.ts`

- [ ] **Step 1: Write integration tests for warmup assembly and endpoint**

Create `apps/api/src/practice/warmup.integration.test.ts`:
- Test that `POST /practice/warmup` returns 401 for unauthenticated calls.
- Test that authenticated call returns exactly 5 puzzles banded within `[rating - 300, rating]`.
- Test that active focus motif is preferred when set.
- Test fallback to top tournament mistake motif when no focus is set.
- Test that warmup puzzles are assigned with `attempts: 0, reviewLevel: 0`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test apps/api/src/practice/warmup.integration.test.ts`
Expected: FAIL (handler not implemented)

- [ ] **Step 3: Implement `assembleWarmup` in `apps/api/src/practice/assemble.ts`**

Define:
```typescript
export const WARMUP_SIZE = 5;

export async function assembleWarmup(
  db: Db,
  playerId: string,
  tournamentId?: string,
  stream?: Stream,
): Promise<WarmupSet | 'pool_empty'> { ... }
```
- Resolve active focus via `playerFocus` and `focusCatalogue`.
- Fall back to top mistake motif from tournament or stream.
- Resolve player rating.
- Gather 5 puzzles in `[rating - 300, rating]` (with fallback ladder widening to `[rating - 400, rating + 100]` if needed).
- Persist assignment in `puzzleAttempt` with `reviewLevel: 0` without advancing review schedule.

- [ ] **Step 4: Mount `postWarmup` in `apps/api/src/practice/warmup.ts` and `app.ts`**

- Authenticate via session.
- Call `assembleWarmup`.
- Return 200 with `WarmupSet` or 422 if empty.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test apps/api/src/practice/warmup.integration.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/practice/assemble.ts apps/api/src/practice/warmup.ts apps/api/src/app.ts apps/api/src/practice/warmup.integration.test.ts
git commit -m "feat(api): implement assembleWarmup and mount POST /practice/warmup (ST-185)"
```

---

### Task 3: Web API Client and Warmup Drill Surface

**Files:**
- Modify: `apps/web/src/api/diagnosis-api.ts`
- Modify: `apps/web/src/query-client.ts`
- Modify: `apps/web/src/routes/practice-route.tsx`
- Test: `apps/web/src/routes/practice-route.warmup.test.tsx`

**Interfaces:**
- Consumes: `POST /practice/warmup` endpoint
- Produces: `warmupQueryOptions`, `startWarmup` API helper, warmup mode in `PracticeRoute`

- [ ] **Step 1: Write unit tests for Warmup drill mode in `practice-route.warmup.test.tsx`**

- Test that warmup mode renders the "Warm-up (X of 5)" progress indicator.
- Test that solving all 5 puzzles displays the completion banner: "You're warmed up and ready for round one. Good luck!".
- Test that daily practice streak query cache invalidation is triggered upon completion.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test apps/web/src/routes/practice-route.warmup.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement client API and warmup flow in `practice-route.tsx`**

- Add `startWarmup(tournamentId?: string, stream?: Stream)` in `diagnosis-api.ts`.
- In `practice-route.tsx`, inspect `mode === 'warmup'`:
  - Fetch warmup puzzles via `useQuery(warmupQueryOptions(tournamentId, stream))`.
  - Display progress header: "Warm-up: Puzzle {current} of 5".
  - After 5th puzzle solved, show completion card with confirmation and button to return to tournament / briefing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test apps/web/src/routes/practice-route.warmup.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/diagnosis-api.ts apps/web/src/query-client.ts apps/web/src/routes/practice-route.tsx apps/web/src/routes/practice-route.warmup.test.tsx
git commit -m "feat(web): add warm-up drill mode and 5-puzzle progress counter (ST-185)"
```

---

### Task 4: Tournament Detail Warmup Card Trigger

**Files:**
- Modify: `apps/web/src/routes/tournament-detail-route.tsx`
- Test: `apps/web/src/routes/tournament-detail-route.test.tsx`

**Interfaces:**
- Consumes: `TournamentDetail` data, `/practice` route with `mode=warmup`
- Produces: Warm-Up Card in tournament header/actions

- [ ] **Step 1: Write component test in `tournament-detail-route.test.tsx`**

- Verify that the tournament detail view renders a "Pre-round warm-up" card with "Start 5-puzzle warm-up" button.
- Verify clicking button navigates to `/practice?mode=warmup&tournamentId={id}`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test apps/web/src/routes/tournament-detail-route.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement Warmup Card in `tournament-detail-route.tsx`**

Add `TournamentWarmupCard` above the games list:
- Header: "Pre-round warm-up"
- Description: "5 quick tactical puzzles targeting your active focus to sharpen calculation before round one."
- Button: "Start 5-puzzle warm-up" linking to `/practice?mode=warmup&tournamentId=${tournamentId}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test apps/web/src/routes/tournament-detail-route.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/tournament-detail-route.tsx apps/web/src/routes/tournament-detail-route.test.tsx
git commit -m "feat(web): add pre-round warm-up card to tournament detail view (ST-185)"
```

---

### Task 5: Full Suite Verification and Story Status Update

**Files:**
- Modify: `delivery/main/stories/ST-185-pre-tournament-warmup-routine.md`
- Modify: `delivery/main/backlog/product-backlog.md`

- [ ] **Step 1: Run full unit and web test suites**

Run: `cd app/feature-st-185 && pnpm test -- --run`
Expected: PASS (all 134+ test files)

- [ ] **Step 2: Update story status to `in-progress` / `complete`**

Update `delivery/main/stories/ST-185-pre-tournament-warmup-routine.md` frontmatter status to `complete`.
Update `delivery/main/backlog/product-backlog.md` row 20 to mark ST-185 `Done`.

- [ ] **Step 3: Commit**

```bash
git commit -m "docs(delivery): mark ST-185 pre-tournament warmup complete"
```

/**
 * ST-106. The practice routes against a real PostgreSQL: the drill always
 * deals 20 from the pool, the fallback ladder widens when the near band is
 * thin, a solved puzzle is excluded from the next deal, a drill record is
 * sticky-solved, a solved drill moves the streak exactly once a day, and the
 * refusals name their reasons.
 */
import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { player, puzzle, puzzleAttempt } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import { XP_PER_ACTIVITY_DAY } from '../players/activity.ts';

let harness: IntegrationDatabase;
const OWNER = 'user_owner';

const sessionFor = (userId: string) => () => ({ userId });

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
  await harness.db
    .insert(user)
    .values([{ id: OWNER, name: 'Owner', email: 'owner@example.com', emailVerified: true }]);
  await harness.db.insert(player).values({ ownerUserId: OWNER, displayName: 'Mina' });
});

/** A dump-format puzzle row, the shape the import script keeps. */
interface PoolSeed {
  id: string;
  rating: number;
  themes: string[];
  /** ST-122. The dump's deepest opening tag, absent when the game named none. */
  opening?: string;
}

async function seedPool(rows: PoolSeed[]): Promise<void> {
  if (rows.length === 0) return;
  await harness.db.insert(puzzle).values(
    rows.map((row) => ({
      lichessId: row.id,
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      moves: 'g1f3 b8c6',
      rating: row.rating,
      themes: row.themes,
      opening: row.opening ?? null,
    })),
  );
}

/** Hanging-piece puzzles around a band centre, named so tests can point at them. */
function band(centre: number, count: number, offset = 0): PoolSeed[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `h${centre}_${i}`,
    rating: centre + offset,
    themes: ['hangingPiece'],
  }));
}

function app(userId: string | null) {
  return createApp({
    db: harness.db,
    getSession: (userId == null ? () => null : sessionFor(userId)) as (c: Context) => unknown,
    aiClient: null,
  });
}

function getDrill(userId: string | null, query: string) {
  // ST-150. The deal is stream-scoped, so every request names its stream.
  return app(userId).request(`/practice/puzzles${query}&stream=tournament`);
}

function postDrill(userId: string | null, body: unknown) {
  return app(userId).request('/practice/puzzles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function playerId(): Promise<string> {
  const [row] = await harness.db.select({ id: player.id }).from(player).limit(1);
  return row!.id;
}

describe('GET /practice/puzzles', () => {
  test('401 without a session', async () => {
    const res = await getDrill(null, '?kind=motif&group=hanging_piece');
    expect(res.status).toBe(401);
  });

  test('422 for a group the theme map does not know', async () => {
    const res = await getDrill(OWNER, '?kind=motif&group=nope');
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'no_such_group' });
  });

  test('503 names the missing import when the pool cannot supply a drill', async () => {
    await seedPool(band(1500, 19));
    const res = await getDrill(OWNER, '?kind=motif&group=hanging_piece');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'pool_empty' });
  });

  test('deals exactly 20 in-band puzzles with the theme and rating echoed', async () => {
    await seedPool(band(1500, 25, 0));
    const res = await getDrill(OWNER, '?kind=motif&group=hanging_piece');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      theme: string;
      rating: number;
      puzzles: { id: string; rating: number }[];
    };
    expect(body.theme).toBe('hangingPiece');
    expect(body.rating).toBe(1500);
    expect(body.puzzles).toHaveLength(20);
    for (const puzzle of body.puzzles) {
      expect(puzzle.rating).toBeGreaterThanOrEqual(1100);
      expect(puzzle.rating).toBeLessThanOrEqual(1900);
    }
  });
  test('the ladder tops up from the wider band when the near one is thin', async () => {
    // Five puzzles inside the ±400 band, twenty-five only inside the ±800
    // band: the near rung must contribute all five, the wider rung the rest.
    await seedPool([...band(1500, 5), ...band(2200, 25)]);
    const res = await getDrill(OWNER, '?kind=motif&group=hanging_piece');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { puzzles: { id: string }[] };
    expect(body.puzzles).toHaveLength(20);
    const near = body.puzzles.filter((p) => p.id.startsWith('h1500')).length;
    expect(near).toBe(5);
  });

  test('a solved puzzle is excluded from the next deal while others remain', async () => {
    await seedPool(band(1500, 30));
    const first = await getDrill(OWNER, '?kind=motif&group=hanging_piece');
    const firstBody = (await first.json()) as { puzzles: { id: string }[] };
    const dealt = firstBody.puzzles[0]!.id;

    const post = await postDrill(OWNER, {
      puzzleId: dealt,
      kind: 'motif',
      group: 'hanging_piece',
      solved: true,
    });
    expect(post.status).toBe(200);

    const second = await getDrill(OWNER, '?kind=motif&group=hanging_piece');
    const secondBody = (await second.json()) as { puzzles: { id: string }[] };
    expect(secondBody.puzzles.map((p) => p.id)).not.toContain(dealt);
    expect(secondBody.puzzles).toHaveLength(20);
  });
});

describe('POST /practice/puzzles', () => {
  beforeEach(async () => {
    await seedPool(band(1500, 25));
  });

  test('401 without a session', async () => {
    const res = await postDrill(null, {
      puzzleId: 'h1500_0',
      kind: 'motif',
      group: 'hanging_piece',
      solved: true,
    });
    expect(res.status).toBe(401);
  });

  test('422 for a puzzle outside the pool and for an unknown group', async () => {
    const noPuzzle = await postDrill(OWNER, {
      puzzleId: 'nope',
      kind: 'motif',
      group: 'hanging_piece',
      solved: true,
    });
    expect(noPuzzle.status).toBe(422);
    expect(await noPuzzle.json()).toMatchObject({ code: 'no_such_puzzle' });

    const noGroup = await postDrill(OWNER, {
      puzzleId: 'h1500_0',
      kind: 'motif',
      group: 'nope',
      solved: true,
    });
    expect(noGroup.status).toBe(422);
    expect(await noGroup.json()).toMatchObject({ code: 'no_such_group' });
  });

  test('a solve is sticky and a reveal never erases it', async () => {
    const reveal = await postDrill(OWNER, {
      puzzleId: 'h1500_0',
      kind: 'motif',
      group: 'hanging_piece',
      solved: false,
    });
    expect(await reveal.json()).toMatchObject({ attempts: 1, solved: false });

    const solve = await postDrill(OWNER, {
      puzzleId: 'h1500_0',
      kind: 'motif',
      group: 'hanging_piece',
      solved: true,
    });
    expect(await solve.json()).toMatchObject({ attempts: 2, solved: true });

    const revealedAgain = await postDrill(OWNER, {
      puzzleId: 'h1500_0',
      kind: 'motif',
      group: 'hanging_piece',
      solved: false,
    });
    expect(await revealedAgain.json()).toMatchObject({ attempts: 3, solved: true });

    const rows = await harness.db.select().from(puzzleAttempt);
    expect(rows).toHaveLength(1);
  });

  test('a solved drill is the day activity, once a day, and a reveal pays nothing', async () => {
    const id = await playerId();

    const reveal = await postDrill(OWNER, {
      puzzleId: 'h1500_0',
      kind: 'motif',
      group: 'hanging_piece',
      solved: false,
    });
    expect(reveal.status).toBe(200);
    const [afterReveal] = await harness.db.select().from(player).where(eq(player.id, id));
    expect(afterReveal!.currentStreak).toBe(0);
    expect(afterReveal!.lastActivityDate).toBeNull();

    await postDrill(OWNER, {
      puzzleId: 'h1500_1',
      kind: 'motif',
      group: 'hanging_piece',
      solved: true,
    });
    await postDrill(OWNER, {
      puzzleId: 'h1500_2',
      kind: 'motif',
      group: 'hanging_piece',
      solved: true,
    });
    const [afterSolve] = await harness.db.select().from(player).where(eq(player.id, id));
    expect(afterSolve!.currentStreak).toBe(1);
    expect(afterSolve!.xp).toBe(XP_PER_ACTIVITY_DAY);
    expect(afterSolve!.lastActivityDate).not.toBeNull();
  });
});

describe('ST-122 opening-matched drills', () => {
  /** Opening-theme puzzles around 1500, the band every deal here starts in. */
  function openingBand(count: number, opening?: string): PoolSeed[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `${opening ?? 'plain'}_${i}`,
      rating: 1500,
      themes: ['opening'],
      opening,
    }));
  }

  test('an opening group deals its mapped ECO family first and names it', async () => {
    await seedPool(openingBand(8, 'Scandinavian_Defense_Main_Line'));
    await seedPool(openingBand(30));
    const response = await getDrill(OWNER, '?kind=opening&group=B01');
    expect(response.status).toBe(200);
    const set = (await response.json()) as { puzzles: { id: string }[]; opening: string | null };
    const family = set.puzzles.filter((p) => p.id.startsWith('Scandinavian'));
    expect(family).toHaveLength(8);
    expect(set.opening).toBe('Scandinavian Defense');
  });

  test('a family the pool does not carry falls through to the theme rungs', async () => {
    await seedPool(openingBand(25, 'Italian_Game'));
    const response = await getDrill(OWNER, '?kind=opening&group=B01');
    expect(response.status).toBe(200);
    const set = (await response.json()) as { puzzles: { id: string }[]; opening: string | null };
    expect(set.puzzles).toHaveLength(20);
    expect(set.opening).toBeNull();
  });

  test('an ECO the map does not cover skips the opening rungs', async () => {
    await seedPool(openingBand(25));
    const response = await getDrill(OWNER, '?kind=opening&group=Z99');
    expect(response.status).toBe(200);
    const set = (await response.json()) as { puzzles: { id: string }[]; opening: string | null };
    expect(set.puzzles).toHaveLength(20);
    expect(set.opening).toBeNull();
  });

  test('a motif deal is unchanged by opening tags on the pool', async () => {
    await seedPool(band(1500, 25));
    await seedPool(openingBand(25, 'Scandinavian_Defense'));
    const response = await getDrill(OWNER, '?kind=motif&group=hanging_piece');
    expect(response.status).toBe(200);
    const set = (await response.json()) as { puzzles: { id: string }[]; opening: string | null };
    expect(set.puzzles.every((p) => p.id.startsWith('h1500_'))).toBe(true);
    expect(set.opening).toBeNull();
  });

  test('re-applying the 0029 seed rewrites the opening and keeps attempts', async () => {
    const seed = readFileSync(
      new URL('../../drizzle/0029_seed_puzzle_openings.sql', import.meta.url),
      'utf8',
    );
    const statement = seed.slice(seed.indexOf('INSERT INTO "puzzle"'));
    expect(statement).toContain(
      'ON CONFLICT ("lichess_id") DO UPDATE SET "opening" = EXCLUDED."opening"',
    );

    // The first tagged row of the real migration becomes the fixture: seeded
    // with a null opening under a recorded attempt, then re-applied.
    const row = /'([A-Za-z0-9]+)', '([^']+)', '([^']+)', (\d+), ARRAY\[[^\]]*\], '([^']+)'/.exec(
      statement,
    );
    expect(row).not.toBeNull();
    const id = row![1]!;
    const fen = row![2]!;
    const moves = row![3]!;
    const rating = row![4]!;
    const opening = row![5]!;
    await harness.db.insert(puzzle).values({
      lichessId: id,
      fen,
      moves,
      rating: Number(rating),
      themes: ['advantage'],
      opening: null,
    });
    await harness.db.insert(puzzleAttempt).values({
      playerId: await playerId(),
      puzzleId: id,
      kind: 'opening',
      groupKey: 'B01',
      attempts: 1,
      solved: true,
      reviewLevel: 1,
      nextReviewAt: new Date(),
      assignedAt: new Date(),
    });

    await harness.sql.unsafe(statement);
    const [after] = await harness.db.select().from(puzzle).where(eq(puzzle.lichessId, id));
    expect(after!.opening).toBe(opening);
    const attempts = await harness.db.select().from(puzzleAttempt);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.attempts).toBe(1);
  });
});

/** Forces a player's attempt row due now, as the clock would eventually. */
async function makeDue(puzzleId: string): Promise<void> {
  await harness.db
    .update(puzzleAttempt)
    .set({ nextReviewAt: new Date(Date.now() - 60_000) })
    .where(and(eq(puzzleAttempt.playerId, await playerId()), eq(puzzleAttempt.puzzleId, puzzleId)));
}

describe('the rating the bands resolve from', () => {
  /** A player's measured ratings, the stand-in for the estimated ELO. */
  async function setRatings(ratings: Partial<typeof player.$inferInsert>): Promise<void> {
    await harness.db.update(player).set(ratings).where(eq(player.ownerUserId, OWNER));
  }

  test('FIDE wins when every rating is present', async () => {
    await seedPool(band(1900, 25));
    await setRatings({
      fideRating: 1900,
      uscfRating: 1800,
      chesscomRating: 1700,
      lichessRating: 1600,
    });
    const res = await getDrill(OWNER, '?kind=motif&group=hanging_piece');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { rating: number }).rating).toBe(1900);
  });

  test('USCF stands in when there is no FIDE rating', async () => {
    await seedPool(band(1800, 25));
    await setRatings({ uscfRating: 1800, chesscomRating: 1700 });
    const res = await getDrill(OWNER, '?kind=motif&group=hanging_piece');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { rating: number }).rating).toBe(1800);
  });

  test('chess.com is read ahead of lichess', async () => {
    await seedPool(band(1700, 25));
    await setRatings({ chesscomRating: 1700, lichessRating: 1600 });
    const res = await getDrill(OWNER, '?kind=motif&group=hanging_piece');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { rating: number }).rating).toBe(1700);
  });

  test('lichess is the last measured rating before the 1500 default', async () => {
    await seedPool(band(1600, 25));
    await setRatings({ lichessRating: 1600 });
    const res = await getDrill(OWNER, '?kind=motif&group=hanging_piece');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { rating: number }).rating).toBe(1600);
  });

  test('the resolved rating moves the bands, not just the echo', async () => {
    await seedPool(band(1500, 25));
    await setRatings({ fideRating: 2400 });
    // 1500 sits outside 2400's widest band: the pool cannot supply a drill.
    const tooFar = await getDrill(OWNER, '?kind=motif&group=hanging_piece');
    expect(tooFar.status).toBe(503);

    await setRatings({ fideRating: null });
    const back = await getDrill(OWNER, '?kind=motif&group=hanging_piece');
    expect(back.status).toBe(200);
    expect(((await back.json()) as { rating: number }).rating).toBe(1500);
  });
});

describe('the fallback ladder beyond the mapped theme', () => {
  test('a thin theme widens to crushing, then to any theme, in ladder order', async () => {
    // Eight in the mapped theme, ten crushing, five advantage: the near rung
    // deals the eight, the crushing rung tops up to eighteen, the any-theme
    // rung closes the drill - the last rung only fires on a real gap.
    await seedPool(band(1500, 8));
    await seedPool(
      Array.from({ length: 10 }, (_, i) => ({
        id: `c1500_${i}`,
        rating: 1500,
        themes: ['crushing'],
      })),
    );
    await seedPool(
      Array.from({ length: 5 }, (_, i) => ({
        id: `a1500_${i}`,
        rating: 1500,
        themes: ['advantage'],
      })),
    );
    const res = await getDrill(OWNER, '?kind=motif&group=hanging_piece');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { theme: string; puzzles: { id: string }[] };
    const ids = body.puzzles.map((p) => p.id);
    expect(ids.filter((id) => id.startsWith('h1500'))).toHaveLength(8);
    expect(ids.filter((id) => id.startsWith('c1500'))).toHaveLength(10);
    expect(ids.filter((id) => id.startsWith('a1500'))).toHaveLength(2);
    expect(ids.slice(0, 8).every((id) => id.startsWith('h1500'))).toBe(true);
    expect(ids.slice(8, 18).every((id) => id.startsWith('c1500'))).toBe(true);
    expect(ids.slice(18).every((id) => id.startsWith('a1500'))).toBe(true);
    // The mapped theme is echoed even when the pool was too thin to fill with it.
    expect(body.theme).toBe('hangingPiece');
  });
});

describe('ST-107 the unfinished deal is honored', () => {
  beforeEach(async () => {
    await seedPool(band(1500, 25));
  });

  async function deal(): Promise<string[]> {
    const res = await getDrill(OWNER, '?kind=motif&group=hanging_piece');
    expect(res.status).toBe(200);
    return ((await res.json()) as { puzzles: { id: string }[] }).puzzles.map((p) => p.id);
  }

  test('re-assembling without recording returns the same deal and adds no rows', async () => {
    const first = await deal();
    const second = await deal();
    expect(new Set(second)).toEqual(new Set(first));
    const rows = await harness.db.select().from(puzzleAttempt);
    expect(rows).toHaveLength(20);
  });

  test('a recorded puzzle leaves the deal; the rest of it stands', async () => {
    const first = await deal();
    const recorded = first[0]!;
    const post = await postDrill(OWNER, {
      puzzleId: recorded,
      kind: 'motif',
      group: 'hanging_piece',
      solved: true,
    });
    expect(post.status).toBe(200);

    const second = await deal();
    expect(second).not.toContain(recorded);
    for (const id of first) {
      if (id !== recorded) expect(second).toContain(id);
    }
    // The one slot the recorded puzzle freed is filled with fresh material.
    expect(second.filter((id) => !first.includes(id))).toHaveLength(1);
  });

  test('a deal owed to another group is not honored here', async () => {
    await deal(); // leaves twenty pending rows for hanging_piece
    const res = await getDrill(OWNER, '?kind=motif&group=missed_threat');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'pool_empty' });
  });
});

describe('ST-124 due reviews open the deal', () => {
  beforeEach(async () => {
    await seedPool(band(1500, 25));
  });

  async function deal(): Promise<string[]> {
    const res = await getDrill(OWNER, '?kind=motif&group=hanging_piece');
    expect(res.status).toBe(200);
    return ((await res.json()) as { puzzles: { id: string }[] }).puzzles.map((p) => p.id);
  }

  async function drill(puzzleId: string, solved: boolean): Promise<void> {
    const res = await postDrill(OWNER, {
      puzzleId,
      kind: 'motif',
      group: 'hanging_piece',
      solved,
    });
    expect(res.status).toBe(200);
  }

  test('a solved puzzle whose review time has passed is dealt again, ahead of fresh material', async () => {
    const first = await deal();
    const reviewed = first[0]!;
    const failed = [first[1]!, first[2]!];
    await drill(reviewed, true);
    for (const id of failed) await drill(id, false);
    await makeDue(reviewed);
    for (const id of failed) await makeDue(id);

    const second = await deal();
    expect(second).toContain(reviewed);
    // A failed puzzle, though due-now, is level 0: not a review, stays out.
    for (const id of failed) expect(second).not.toContain(id);
    // Pending rows open the deal, the due review closes them out, fresh fills the rest.
    const pending = first.filter((id) => id !== reviewed && !failed.includes(id));
    const reviewIndex = second.indexOf(reviewed);
    expect(new Set(second.slice(0, reviewIndex))).toEqual(new Set(pending));
    for (const fresh of second.filter((id) => !first.includes(id))) {
      expect(second.indexOf(fresh)).toBeGreaterThan(reviewIndex);
    }
  });

  test('a future review is not due and an early deal is filled from fresh material', async () => {
    const first = await deal();
    const solved = first[0]!; // climbs to level 1, due in two days
    const revealed = first[1]!;
    await drill(solved, true);
    await drill(revealed, false);
    await makeDue(revealed);

    const second = await deal();
    expect(second).toHaveLength(20);
    expect(second).not.toContain(solved);
    expect(second).not.toContain(revealed);
  });
});

describe('ST-124 the review ladder on record', () => {
  beforeEach(async () => {
    await seedPool(band(1500, 25));
  });

  const DAY = 24 * 60 * 60 * 1000;

  const drill = (puzzleId: string, solved: boolean) =>
    postDrill(OWNER, { puzzleId, kind: 'motif', group: 'hanging_piece', solved });

  function expectNear(iso: string, days: number): void {
    expect(Math.abs(new Date(iso).getTime() - (Date.now() + days * DAY))).toBeLessThan(DAY / 2);
  }

  test('a solve climbs two, seven, thirty days and caps at the top rung', async () => {
    const rungs: Array<[number, number]> = [
      [1, 2],
      [2, 7],
      [3, 30],
      [3, 30],
    ];
    for (const [level, days] of rungs) {
      const res = await drill('h1500_0', true);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { reviewLevel: number; nextReviewAt: string };
      expect(body.reviewLevel).toBe(level);
      expectNear(body.nextReviewAt, days);
    }
  });

  test('a reveal drops the ladder back to due-now', async () => {
    await drill('h1500_0', true);
    const res = await drill('h1500_0', false);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reviewLevel: number; nextReviewAt: string };
    expect(body.reviewLevel).toBe(0);
    expectNear(body.nextReviewAt, 0);
  });

  test('only a solve on a due rung stamps review_solved_at', async () => {
    const pid = await playerId();
    const row = () =>
      harness.db
        .select()
        .from(puzzleAttempt)
        .where(and(eq(puzzleAttempt.playerId, pid), eq(puzzleAttempt.puzzleId, 'h1500_0')));

    // The first solve is not a review: it puts the puzzle on the ladder.
    await drill('h1500_0', true);
    const [afterFirst] = await row();
    expect(afterFirst!.reviewSolvedAt).toBeNull();

    await makeDue('h1500_0');
    await drill('h1500_0', true);
    const [afterDue] = await row();
    expect(afterDue!.reviewSolvedAt).not.toBeNull();
    const stamp = afterDue!.reviewSolvedAt!.getTime();
    expect(afterDue!.reviewLevel).toBe(2);

    // An early re-solve is extra practice and stamps nothing.
    await drill('h1500_0', true);
    const [afterEarly] = await row();
    expect(afterEarly!.reviewSolvedAt!.getTime()).toBe(stamp);
    expect(afterEarly!.reviewLevel).toBe(3);

    // A reveal never touches the stamp.
    await drill('h1500_0', false);
    const [afterReveal] = await row();
    expect(afterReveal!.reviewSolvedAt!.getTime()).toBe(stamp);
    expect(afterReveal!.reviewLevel).toBe(0);
  });
});

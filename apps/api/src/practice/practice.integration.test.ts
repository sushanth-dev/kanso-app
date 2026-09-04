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
import { eq } from 'drizzle-orm';
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
  return app(userId).request(`/practice/puzzles${query}`);
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

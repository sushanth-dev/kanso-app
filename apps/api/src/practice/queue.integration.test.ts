/**
 * ST-107. The review pipeline against a real PostgreSQL: a deal is assigned
 * the moment it is dealt (so an abandoned session resumes instead of
 * repeating), a solve climbs the Leitner ladder while a reveal drops back to
 * the due-now box, and the queue route serves the three buckets the puzzles
 * page shows.
 */
import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { createApp } from '../app.ts';
import { player, puzzle, puzzleAttempt } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';

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
    })),
  );
}

function band(centre: number, count: number): PoolSeed[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `h${centre}_${i}`,
    rating: centre,
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

const QUERY = '?kind=motif&group=hanging_piece';

async function playerId(): Promise<string> {
  const [row] = await harness.db.select({ id: player.id }).from(player).limit(1);
  return row!.id;
}

function getDrill(userId: string) {
  return app(userId).request(`/practice/puzzles${QUERY}`);
}

function postDrill(userId: string, puzzleId: string, solved: boolean) {
  return app(userId).request('/practice/puzzles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ puzzleId, kind: 'motif', group: 'hanging_piece', solved }),
  });
}

function getQueue(userId: string | null) {
  return app(userId).request('/practice/queue');
}

interface QueueItem {
  puzzleId: string;
  reviewLevel: number;
  attempts: number;
  nextReviewAt: string;
}

async function dealOf(userId: string): Promise<string[]> {
  const res = await getDrill(userId);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { puzzles: { id: string }[] };
  return body.puzzles.map((p) => p.id);
}

async function queueOf(
  userId: string,
): Promise<{ due: QueueItem[]; upcoming: QueueItem[]; mastered: QueueItem[] }> {
  const res = await getQueue(userId);
  expect(res.status).toBe(200);
  return (await res.json()) as { due: QueueItem[]; upcoming: QueueItem[]; mastered: QueueItem[] };
}

describe('GET /practice/queue (ST-107)', () => {
  test('401 without a session', async () => {
    const res = await getQueue(null);
    expect(res.status).toBe(401);
  });

  test('a deal abandoned mid-session is dealt again, not repeated', async () => {
    await seedPool(band(1500, 45));
    const first = await dealOf(OWNER);
    expect(first).toHaveLength(20);
    // No POST at all: the tab closed after the deal. The next deal resumes
    // the assignment instead of dealing twenty fresh puzzles.
    const second = await dealOf(OWNER);
    expect(second).toEqual(first);
    const rows = await harness.db
      .select({ puzzleId: puzzleAttempt.puzzleId })
      .from(puzzleAttempt)
      .where(eq(puzzleAttempt.playerId, await playerId()));
    expect(rows).toHaveLength(20);
  });

  test('a recorded drill leaves the deal and enters the review ladder', async () => {
    await seedPool(band(1500, 45));
    const first = await dealOf(OWNER);

    const post = await postDrill(OWNER, first[0]!, true);
    expect(post.status).toBe(200);
    const tally = (await post.json()) as {
      attempts: number;
      solved: boolean;
      reviewLevel: number;
    };
    expect(tally).toMatchObject({ attempts: 1, solved: true, reviewLevel: 1 });

    const second = await dealOf(OWNER);
    // The dealt-and-started puzzle never returns; the nineteen untouched
    // assignments resume, and exactly one fresh puzzle tops the deal up.
    expect(second).not.toContain(first[0]);
    expect(second.filter((id) => first.includes(id))).toHaveLength(19);
    expect(second).toHaveLength(20);

    const queue = await queueOf(OWNER);
    const solvedRow = queue.upcoming.find((i) => i.puzzleId === first[0]);
    expect(solvedRow).toBeDefined();
    // Two days out from the database's own clock, so the comparison cannot be
    // flattered or broken by node-vs-Postgres clock skew on a containerized
    // database - a few dozen milliseconds decide which bucket a just-dealt
    // puzzle lands in, but never whether a two-day review is in the future.
    expect(new Date(solvedRow!.nextReviewAt).getTime() - Date.now()).toBeGreaterThan(86_400_000);
    // The twenty untouched deals stay pending - the nineteen from the first
    // deal plus the one fresh puzzle that topped the deal up - whichever
    // bucket their dealing timestamp fell into. The solved one is not among
    // them; it waits in the review ladder instead.
    const pending = [...queue.due, ...queue.upcoming]
      .filter((i) => i.puzzleId !== first[0])
      .map((i) => i.puzzleId);
    expect(pending).toHaveLength(20);
    expect(pending.filter((id) => first.includes(id))).toHaveLength(19);
    expect(queue.due.map((i) => i.puzzleId)).not.toContain(first[0]);
    expect(queue.mastered).toHaveLength(0);
  });

  test('a reveal drops back to due-now; solves climb 2/7/30 and stop at rung 3', async () => {
    await seedPool(band(1500, 45));
    const first = await dealOf(OWNER);

    const reveal = await postDrill(OWNER, first[0]!, false);
    const revealTally = (await reveal.json()) as { reviewLevel: number };
    expect(revealTally.reviewLevel).toBe(0);
    let queue = await queueOf(OWNER);
    expect(queue.due.map((i) => i.puzzleId)).toContain(first[0]);

    // ST-124. Each solve climbs one rung - two, seven, then thirty days -
    // and the ladder caps at 3: a fourth solve stays at rung 3 and merely
    // schedules the next thirty-day return. The immediately repeated solves
    // are early re-drills, not reviews, so nothing stamps review_solved_at.
    const days = [2, 7, 30, 30];
    const levels: number[] = [];
    for (let i = 0; i < 4; i++) {
      const post = await postDrill(OWNER, first[0]!, true);
      const tally = (await post.json()) as { reviewLevel: number; nextReviewAt: string };
      levels.push(tally.reviewLevel);
      const expected = Date.now() + days[i]! * 86_400_000;
      expect(Math.abs(new Date(tally.nextReviewAt).getTime() - expected)).toBeLessThan(60_000);
    }
    expect(levels).toEqual([1, 2, 3, 3]);
    const [row] = await harness.db
      .select({ reviewSolvedAt: puzzleAttempt.reviewSolvedAt })
      .from(puzzleAttempt)
      .where(
        and(eq(puzzleAttempt.playerId, await playerId()), eq(puzzleAttempt.puzzleId, first[0]!)),
      );
    expect(row!.reviewSolvedAt).toBeNull();

    queue = await queueOf(OWNER);
    expect(queue.mastered.map((i) => i.puzzleId)).toContain(first[0]);
    expect(queue.due.map((i) => i.puzzleId)).not.toContain(first[0]);
    expect(queue.upcoming.map((i) => i.puzzleId)).not.toContain(first[0]);
  });

  test('a puzzle keeps the group that claimed it first', async () => {
    await seedPool(band(1500, 45));
    const first = await dealOf(OWNER);
    await postDrill(OWNER, first[0]!, true);
    const [row] = await harness.db
      .select({
        kind: puzzleAttempt.kind,
        groupKey: puzzleAttempt.groupKey,
        attempts: puzzleAttempt.attempts,
      })
      .from(puzzleAttempt)
      .where(
        and(eq(puzzleAttempt.playerId, await playerId()), eq(puzzleAttempt.puzzleId, first[0]!)),
      );
    expect(row).toMatchObject({ kind: 'motif', groupKey: 'hanging_piece', attempts: 1 });
  });
});

describe('ST-124 review ladder, deal preference, and the ten-a-day cap', () => {
  /** Hours before now, so a seeded row sits due without clock arithmetic. */
  const past = (hours: number) => new Date(Date.now() - hours * 3_600_000);
  const future = (days: number) => new Date(Date.now() + days * 86_400_000);

  async function getReviews(userId: string | null) {
    const res = await app(userId).request('/practice/reviews');
    return res;
  }

  test('401 without a session', async () => {
    expect((await getReviews(null)).status).toBe(401);
  });

  test('the deal opens with the group due reviews before any fresh material', async () => {
    await seedPool(band(1500, 45));
    const first = await dealOf(OWNER);

    // One solved puzzle pushed past its review time, one revealed today:
    // the solved one is a due review, the revealed one is a level-0 redo
    // that must not ride back with the deal.
    await postDrill(OWNER, first[0]!, true);
    await postDrill(OWNER, first[1]!, false);
    await harness.db
      .update(puzzleAttempt)
      .set({ nextReviewAt: past(1) })
      .where(
        and(eq(puzzleAttempt.playerId, await playerId()), eq(puzzleAttempt.puzzleId, first[0]!)),
      );

    const second = await dealOf(OWNER);
    expect(second).toHaveLength(20);
    expect(second).toContain(first[0]);
    expect(second).not.toContain(first[1]);
    const duePosition = second.indexOf(first[0]!);
    const firstFresh = second.findIndex((id) => !first.includes(id));
    // The nineteen still-unstarted assignments resume first, the due review
    // follows them, and fresh material never precedes it.
    expect(duePosition).toBeLessThan(firstFresh);
  });

  test('a review solve stamps the day; a redo of a failed puzzle does not', async () => {
    await seedPool(band(1500, 45));
    const first = await dealOf(OWNER);
    const pid = await playerId();

    // first[0] becomes a due level-1 review; first[1] a due level-0 redo.
    await postDrill(OWNER, first[0]!, true);
    await harness.db
      .update(puzzleAttempt)
      .set({ nextReviewAt: past(1) })
      .where(and(eq(puzzleAttempt.playerId, pid), eq(puzzleAttempt.puzzleId, first[0]!)));
    await postDrill(OWNER, first[1]!, false);

    const reviewed = await postDrill(OWNER, first[0]!, true);
    expect((await reviewed.json()) as { reviewLevel: number }).toMatchObject({ reviewLevel: 2 });
    const redone = await postDrill(OWNER, first[1]!, true);
    expect((await redone.json()) as { reviewLevel: number }).toMatchObject({ reviewLevel: 1 });

    const rows = await harness.db
      .select({ puzzleId: puzzleAttempt.puzzleId, reviewSolvedAt: puzzleAttempt.reviewSolvedAt })
      .from(puzzleAttempt)
      .where(eq(puzzleAttempt.playerId, pid));
    const byId = new Map(rows.map((r) => [r.puzzleId, r.reviewSolvedAt]));
    expect(byId.get(first[0]!)!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(byId.get(first[1]!)).toBeNull();
  });

  test('the due section serves what is left of ten review solves today', async () => {
    await seedPool(band(1500, 45));
    const dealt = await dealOf(OWNER);
    const pid = await playerId();
    // Attempt rows must not collide with the deal's own rows, so the
    // fixtures come from the pool the deal left untouched.
    const spare = Array.from({ length: 45 }, (_, i) => `h1500_${i}`).filter(
      (id) => !dealt.includes(id),
    );

    // Nine reviews already solved today (their next return scheduled away),
    // five puzzles due and unstamped: the section owes exactly one more.
    await harness.db.insert(puzzleAttempt).values([
      ...spare.slice(0, 9).map((id) => ({
        playerId: pid,
        puzzleId: id,
        kind: 'motif' as const,
        groupKey: 'hanging_piece',
        attempts: 1,
        solved: true,
        reviewLevel: 1,
        nextReviewAt: future(2),
        reviewSolvedAt: new Date(),
        assignedAt: new Date(),
      })),
      ...spare.slice(9, 14).map((id) => ({
        playerId: pid,
        puzzleId: id,
        kind: 'motif' as const,
        groupKey: 'hanging_piece',
        attempts: 1,
        solved: true,
        reviewLevel: 1,
        nextReviewAt: past(1),
        assignedAt: new Date(),
      })),
    ]);

    const res = await getReviews(OWNER);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      reviews: { puzzleId: string; kind: string; group: string; reviewLevel: number }[];
      remaining: number;
    };
    expect(body.remaining).toBe(1);
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0]).toMatchObject({
      kind: 'motif',
      group: 'hanging_piece',
      reviewLevel: 1,
    });
  });

  test('the cap empties the section once ten reviews are solved today', async () => {
    await seedPool(band(1500, 45));
    const dealt = await dealOf(OWNER);
    const pid = await playerId();
    const spare = Array.from({ length: 45 }, (_, i) => `h1500_${i}`).filter(
      (id) => !dealt.includes(id),
    );

    // Ten reviews solved today and five more due: the day is spent, and the
    // section says so rather than serving an eleventh.
    await harness.db.insert(puzzleAttempt).values([
      ...spare.slice(0, 10).map((id) => ({
        playerId: pid,
        puzzleId: id,
        kind: 'motif' as const,
        groupKey: 'hanging_piece',
        attempts: 1,
        solved: true,
        reviewLevel: 1,
        nextReviewAt: future(2),
        reviewSolvedAt: new Date(),
        assignedAt: new Date(),
      })),
      ...spare.slice(10, 15).map((id) => ({
        playerId: pid,
        puzzleId: id,
        kind: 'motif' as const,
        groupKey: 'hanging_piece',
        attempts: 1,
        solved: true,
        reviewLevel: 1,
        nextReviewAt: past(1),
        assignedAt: new Date(),
      })),
    ]);

    const res = await getReviews(OWNER);
    expect(await res.json()).toMatchObject({ reviews: [], remaining: 0 });
  });
});

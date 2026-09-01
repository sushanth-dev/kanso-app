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
    expect(queue.upcoming.map((i) => i.puzzleId)).toContain(first[0]);
    expect(queue.upcoming[0]!.nextReviewAt > new Date().toISOString()).toBe(true);
    // The twenty untouched deals are pending now - the nineteen from the
    // first deal plus the one fresh puzzle that topped the deal up. The
    // solved one is not among them.
    expect(queue.due.map((i) => i.puzzleId)).not.toContain(first[0]);
    expect(queue.due).toHaveLength(20);
    expect(queue.mastered).toHaveLength(0);
  });

  test('a reveal drops back to the due-now box; four solves master a puzzle', async () => {
    await seedPool(band(1500, 45));
    const first = await dealOf(OWNER);

    const reveal = await postDrill(OWNER, first[0]!, false);
    const revealTally = (await reveal.json()) as { reviewLevel: number };
    expect(revealTally.reviewLevel).toBe(0);
    let queue = await queueOf(OWNER);
    expect(queue.due.map((i) => i.puzzleId)).toContain(first[0]);

    // Each subsequent solve climbs one box: 1, 2, 3, then the mastered 4.
    const levels: number[] = [];
    for (let i = 0; i < 4; i++) {
      const post = await postDrill(OWNER, first[0]!, true);
      levels.push(((await post.json()) as { reviewLevel: number }).reviewLevel);
    }
    expect(levels).toEqual([1, 2, 3, 4]);

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

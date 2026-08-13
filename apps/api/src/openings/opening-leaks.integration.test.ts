/**
 * The opening-leak aggregation against a real PostgreSQL, with fixture games and
 * mistakes in the real tables. The scoring is unit-tested in opening-leaks.test.ts;
 * this covers what only a database proves: the grouping, the analyzed-only and
 * per-stream filters, the most-recent opening name, and that two players' data
 * never mix.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { game, mistake, player, tournament } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import { openingLeaks } from './opening-leaks.ts';

let harness: IntegrationDatabase;
const OWNER = 'user_owner';
const OTHER = 'user_other';

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
  await harness.db.insert(user).values([
    { id: OWNER, name: 'Owner', email: 'owner@example.com', emailVerified: true },
    { id: OTHER, name: 'Other', email: 'other@example.com', emailVerified: true },
  ]);
});

async function makePlayer(ownerId: string): Promise<string> {
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: ownerId, displayName: 'Sushanth Kamabathula' })
    .returning({ id: player.id });
  return row.id;
}

/** Insert a tournament row and return its id. */
async function seedTournament(
  playerId: string,
  fields: Partial<typeof tournament.$inferInsert> = {},
): Promise<string> {
  const [t] = await harness.db
    .insert(tournament)
    .values({ playerId, name: 'Autumn Open', key: 'autumn open', ...fields })
    .returning({ id: tournament.id });
  return t.id;
}

let seq = 0;
async function insertGame(
  playerId: string,
  fields: Partial<typeof game.$inferInsert> = {},
): Promise<string> {
  const [row] = await harness.db
    .insert(game)
    .values({
      playerId,
      stream: 'tournament',
      source: 'pgn_upload',
      pgnHash: `hash_${playerId}_${seq++}`,
      pgn: '[Result "1-0"]\n\n1. e4 e5 1-0',
      result: '1-0',
      eco: 'B10',
      analysisStatus: 'complete',
      ...fields,
    })
    .returning({ id: game.id });
  return row.id;
}

/** Attach `n` mistakes to a game. Only the count matters to the aggregation. */
async function addMistakes(gameId: string, n: number): Promise<void> {
  if (n === 0) return;
  await harness.db.insert(mistake).values(
    Array.from({ length: n }, (_, i) => ({
      gameId,
      ply: i + 1,
      moveNumber: i + 1,
      movingColor: 'white' as const,
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      moveSan: 'e4',
      bestMoveSan: 'd4',
      judgement: 'mistake' as const,
      cpLoss: 200,
      winProbDrop: 0.2,
    })),
  );
}

describe('openingLeaks', () => {
  test('groups by ECO and ranks by mistakes per game', async () => {
    const p = await makePlayer(OWNER);
    // B10: two games, 4 mistakes → 2.0, high.
    for (const n of [3, 1]) await addMistakes(await insertGame(p, { eco: 'B10' }), n);
    // C50: two games, 1 mistake → 0.5, neutral (boundary).
    for (const n of [1, 0]) await addMistakes(await insertGame(p, { eco: 'C50' }), n);

    const { leaks, withheld } = await openingLeaks(harness.db, p, 'tournament');
    expect(withheld).toBe(0);
    expect(
      leaks.map((l) => ({ eco: l.eco, score: l.leakScore, band: l.band, games: l.games })),
    ).toEqual([
      { eco: 'B10', score: 2, band: 'high', games: 2 },
      { eco: 'C50', score: 0.5, band: 'neutral', games: 2 },
    ]);
  });

  test('withholds an opening with only one game and counts it', async () => {
    const p = await makePlayer(OWNER);
    await addMistakes(await insertGame(p, { eco: 'B10' }), 2);
    await addMistakes(await insertGame(p, { eco: 'B10' }), 2);
    await addMistakes(await insertGame(p, { eco: 'A00' }), 9); // one game, not reported

    const { leaks, withheld } = await openingLeaks(harness.db, p, 'tournament');
    expect(leaks.map((l) => l.eco)).toEqual(['B10']);
    expect(withheld).toBe(1);
  });

  test('excludes unanalyzed games, so an opening cannot look clean unlooked-at', async () => {
    const p = await makePlayer(OWNER);
    // Two analyzed games, no mistakes → a real, clean 0.0 opening.
    await insertGame(p, { eco: 'B10' });
    await insertGame(p, { eco: 'B10' });
    // A pending game with mistakes on it must not be counted at all.
    await addMistakes(await insertGame(p, { eco: 'B10', analysisStatus: 'pending' }), 5);

    const { leaks } = await openingLeaks(harness.db, p, 'tournament');
    expect(leaks).toEqual([
      expect.objectContaining({ eco: 'B10', games: 2, mistakes: 0, leakScore: 0, band: 'low' }),
    ]);
  });

  test('takes the opening name from the most recent game in the group', async () => {
    const p = await makePlayer(OWNER);
    await insertGame(p, {
      eco: 'B10',
      opening: 'Caro-Kann Defense',
      playedAt: new Date('2025-01-01T00:00:00Z'),
    });
    await insertGame(p, {
      eco: 'B10',
      opening: 'Caro-Kann: Advance',
      playedAt: new Date('2025-06-01T00:00:00Z'),
    });

    const { leaks } = await openingLeaks(harness.db, p, 'tournament');
    expect(leaks[0].openingName).toBe('Caro-Kann: Advance');
  });

  test('never blends streams: each returns its own games and its own scores', async () => {
    const p = await makePlayer(OWNER);
    // Tournament B10: two games, 4 mistakes → 2.0.
    for (const n of [3, 1])
      await addMistakes(await insertGame(p, { stream: 'tournament', eco: 'B10' }), n);
    // Online B10: two games, 0 mistakes → 0.0.
    for (const n of [0, 0])
      await addMistakes(await insertGame(p, { stream: 'online', eco: 'B10' }), n);

    const tournament = await openingLeaks(harness.db, p, 'tournament');
    const online = await openingLeaks(harness.db, p, 'online');
    expect(tournament.leaks[0].leakScore).toBe(2);
    expect(online.leaks[0].leakScore).toBe(0);
    // Same ECO, same player, opposite streams: the scores can only differ if
    // neither result counted the other stream's games.
    expect(tournament.leaks[0].games).toBe(2);
    expect(online.leaks[0].games).toBe(2);
  });

  test('a player with no games in the stream gets an empty result, not an error', async () => {
    const p = await makePlayer(OWNER);
    await addMistakes(await insertGame(p, { stream: 'online', eco: 'B10' }), 2);
    await addMistakes(await insertGame(p, { stream: 'online', eco: 'B10' }), 2);

    expect(await openingLeaks(harness.db, p, 'tournament')).toEqual({ leaks: [], withheld: 0 });
  });

  test('never counts another player’s games', async () => {
    const mine = await makePlayer(OWNER);
    const theirs = await makePlayer(OTHER);
    await addMistakes(await insertGame(mine, { eco: 'B10' }), 1);
    await addMistakes(await insertGame(mine, { eco: 'B10' }), 1);
    // The other player has the same ECO but far more mistakes; if it leaked in,
    // the score would jump.
    await addMistakes(await insertGame(theirs, { eco: 'B10' }), 10);
    await addMistakes(await insertGame(theirs, { eco: 'B10' }), 10);

    const { leaks } = await openingLeaks(harness.db, mine, 'tournament');
    expect(leaks[0].leakScore).toBe(1);
  });

  test('scopes to one tournament: neither result contains the other’s games', async () => {
    const p = await makePlayer(OWNER);
    const t1 = await seedTournament(p);
    const t2 = await seedTournament(p);
    // Two games in t1 with 4 mistakes → 2.0, high; two games in t2 with 0
    // mistakes → 0.0, low. Same ECO, same player, opposite tournaments: the
    // scores can only differ if the scoped query separates them.
    for (const n of [3, 1])
      await addMistakes(await insertGame(p, { tournamentId: t1, eco: 'B10' }), n);
    for (const n of [0, 0])
      await addMistakes(await insertGame(p, { tournamentId: t2, eco: 'B10' }), n);

    const inT1 = await openingLeaks(harness.db, p, 'tournament', t1);
    expect(inT1.leaks).toHaveLength(1);
    expect(inT1.leaks[0].leakScore).toBe(2);
    expect(inT1.leaks[0].games).toBe(2);

    const inT2 = await openingLeaks(harness.db, p, 'tournament', t2);
    expect(inT2.leaks).toHaveLength(1);
    expect(inT2.leaks[0].leakScore).toBe(0);
    expect(inT2.leaks[0].games).toBe(2);

    // The scoped scores differ, which is only possible if neither query
    // counted the other tournament's games.
    expect(inT1.leaks[0].leakScore).not.toBe(inT2.leaks[0].leakScore);
  });
});

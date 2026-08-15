/**
 * ST-026. The rating leak computation against a real PostgreSQL: per-kind
 * aggregation, stream scoping, the season window, and the thin-evidence
 * refusal.
 *
 * The boundary rule and the conversion are unit-tested in their own files, so
 * these seed mistakes with an explicit `half_points_lost` and exercise the
 * aggregation, the baseline, and the refusal rather than re-deriving a
 * boundary.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import { game, mistake, movePly, player } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { computeLeaks } from './leak.ts';

let harness: IntegrationDatabase;

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
    .values({ id: 'user_owner', name: 'Owner', email: 'owner@example.com', emailVerified: true });
});

async function makePlayer(): Promise<string> {
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: 'user_owner', displayName: 'Test Player' })
    .returning({ id: player.id });
  return row!.id;
}

let seq = 0;
/** Insert one rated game. Defaults to a white draw against an equal opponent. */
async function seedRatedGame(
  playerId: string,
  fields: Partial<typeof game.$inferInsert> = {},
): Promise<string> {
  const [row] = await harness.db
    .insert(game)
    .values({
      playerId,
      stream: 'online',
      source: 'chesscom',
      pgnHash: `hash_${seq++}`,
      pgn: '[Result "1/2-1/2"]\n\n1. e4 e5 1/2-1/2',
      result: '1/2-1/2',
      playerColor: 'white',
      whiteElo: 1500,
      blackElo: 1500,
      playedAt: new Date('2026-08-01T12:00:00Z'),
      analysisStatus: 'complete',
      ...fields,
    })
    .returning({ id: game.id });
  return row!.id;
}

async function addMistake(
  gameId: string,
  fields: Partial<typeof mistake.$inferInsert> = {},
): Promise<void> {
  await harness.db.insert(mistake).values({
    gameId,
    ply: 1,
    moveNumber: 1,
    movingColor: 'white',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moveSan: 'e4',
    bestMoveSan: 'd4',
    judgement: 'mistake',
    cpLoss: 100,
    winProbDrop: 0.2,
    halfPointsLost: 1,
    crossedResultBoundary: true,
    phase: null,
    motif: null,
    ...fields,
  });
}

async function addClockMove(gameId: string, ply: number, clockMs: number): Promise<void> {
  await harness.db.insert(movePly).values({
    gameId,
    ply,
    san: 'e4',
    uci: 'e2e4',
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    clockMs,
  });
}

describe('computeLeaks', () => {
  test('computes the leak per kind over the season rated games', async () => {
    const playerId = await makePlayer();
    // 10 rated draws: S=5.0, N=10, R=1500.
    const g1 = await seedRatedGame(playerId, { eco: 'B22', opening: 'Sicilian, Alapin' });
    const g2 = await seedRatedGame(playerId, { eco: 'B22', opening: 'Sicilian, Alapin' });
    const g3 = await seedRatedGame(playerId, { eco: 'B20' });
    for (let i = 0; i < 7; i++) await seedRatedGame(playerId);

    await addMistake(g1, { halfPointsLost: 1, motif: 'hanging_piece', phase: 'middlegame' });
    await addMistake(g2, { halfPointsLost: 1, phase: 'middlegame' });
    await addMistake(g3, { halfPointsLost: 1, phase: 'opening' });
    // The g1 and g2 mistakes sit inside the trouble window.
    await addClockMove(g1, 1, 20_000);
    await addClockMove(g2, 1, 20_000);

    const result = await computeLeaks(harness.db, playerId, 'online');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    expect(result.baseline.games).toBe(10);
    expect(result.baseline.score).toBeCloseTo(5);
    expect(result.baseline.avgOpponentElo).toBeCloseTo(1500);

    const find = (kind: string, key: string) =>
      result.weaknesses.find((w) => w.kind === kind && w.key === key)!;

    expect(find('opening', 'B22').halfPointsLost).toBeCloseTo(2);
    expect(find('opening', 'B22').occurrences).toBe(2);
    expect(find('opening', 'B22').gamesAffected).toBe(2);
    expect(find('opening', 'B22').ratingLeak).toBe(147);

    expect(find('opening', 'B20').halfPointsLost).toBeCloseTo(1);
    expect(find('opening', 'B20').ratingLeak).toBe(70);

    expect(find('motif', 'hanging_piece').halfPointsLost).toBeCloseTo(1);

    expect(find('phase', 'middlegame').halfPointsLost).toBeCloseTo(2);
    expect(find('phase', 'opening').halfPointsLost).toBeCloseTo(1);

    expect(find('time_trouble', 'time_trouble').halfPointsLost).toBeCloseTo(2);
    expect(find('time_trouble', 'time_trouble').ratingLeak).toBe(147);

    // ST-027. Labels travel with the leak: the opening name from `game.opening`,
    // the ECO code on openings only, and humanized names for the other kinds.
    expect(find('opening', 'B22').label).toBe('Sicilian, Alapin');
    expect(find('opening', 'B22').eco).toBe('B22');
    expect(find('opening', 'B20').label).toBe('B20');
    expect(find('opening', 'B20').eco).toBe('B20');
    expect(find('motif', 'hanging_piece').label).toBe('Hanging piece');
    expect(find('motif', 'hanging_piece').eco).toBeNull();
    expect(find('phase', 'middlegame').label).toBe('Middlegame');
    expect(find('phase', 'middlegame').eco).toBeNull();
    expect(find('time_trouble', 'time_trouble').label).toBe('Time trouble');
    expect(find('time_trouble', 'time_trouble').eco).toBeNull();

    // Worst first by half-points, not by row count.
    expect(result.weaknesses[0]!.halfPointsLost).toBeCloseTo(2);
    expect(result.weaknesses).toHaveLength(6);
  });

  test('never blends streams', async () => {
    const playerId = await makePlayer();
    for (let i = 0; i < 10; i++) {
      const id = await seedRatedGame(playerId, { stream: 'online', eco: 'B22' });
      await addMistake(id, { motif: 'hanging_piece' });
    }
    for (let i = 0; i < 10; i++) {
      const id = await seedRatedGame(playerId, { stream: 'tournament', eco: 'B20' });
      await addMistake(id, { motif: 'missed_capture' });
    }

    const online = await computeLeaks(harness.db, playerId, 'online');
    const tournament = await computeLeaks(harness.db, playerId, 'tournament');
    expect(online.kind).toBe('ok');
    expect(tournament.kind).toBe('ok');
    if (online.kind !== 'ok' || tournament.kind !== 'ok') return;

    const keys = (r: { weaknesses: { kind: string; key: string }[] }) =>
      r.weaknesses.map((w) => `${w.kind}:${w.key}`);
    expect(keys(online)).toEqual(['motif:hanging_piece', 'opening:B22']);
    expect(keys(tournament)).toEqual(['motif:missed_capture', 'opening:B20']);
  });

  test('refuses below ten rated games', async () => {
    const playerId = await makePlayer();
    for (let i = 0; i < 9; i++) await seedRatedGame(playerId);

    const result = await computeLeaks(harness.db, playerId, 'online');
    expect(result.kind).toBe('not_enough_evidence');
  });

  test('a season is one rolling year and reads the opponent rating from the player colour', async () => {
    const playerId = await makePlayer();
    // 10 recent games where the player is black, opponent white Elo 1800.
    for (let i = 0; i < 10; i++) {
      await seedRatedGame(playerId, { playerColor: 'black', whiteElo: 1800, blackElo: 1200 });
    }
    // One rated game more than a year earlier: outside the season.
    const oldGame = await seedRatedGame(playerId, {
      playerColor: 'black',
      whiteElo: 1800,
      blackElo: 1200,
      eco: 'B22',
      playedAt: new Date('2025-01-01T12:00:00Z'),
    });
    await addMistake(oldGame, { halfPointsLost: 1, phase: 'opening' });

    const result = await computeLeaks(harness.db, playerId, 'online');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    expect(result.baseline.games).toBe(10);
    expect(result.baseline.avgOpponentElo).toBeCloseTo(1800);
    expect(result.weaknesses).toEqual([]);
  });
});

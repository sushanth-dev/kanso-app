/**
 * The phase endpoint against a real PostgreSQL, with fixture games, mistakes,
 * and clocked moves in the real tables. The scoring is unit-tested in
 * phases.test.ts; this covers what only a database proves: the per-stream
 * grouping, the analysed-only filter, the no-data refusal, the clocked-game
 * aggregation, and that a second player's claim is refused.
 */
import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { game, mistake, movePly, player } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import type { Phase } from '../analysis/phase.ts';

let harness: IntegrationDatabase;
const OWNER = 'user_owner';
const OTHER = 'user_other';
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const sessionFor = (userId: string) => () => ({ userId });

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

function app(userId: string | null) {
  return createApp({
    db: harness.db,
    getSession: (userId == null ? () => null : sessionFor(userId)) as (c: Context) => unknown,
  });
}

async function get(userId: string | null, playerId: string, stream: string) {
  return app(userId).request(`/players/${playerId}/phase?stream=${stream}`);
}

async function makePlayer(ownerId: string): Promise<string> {
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: ownerId, displayName: 'Test Player' })
    .returning({ id: player.id });
  return row!.id;
}

let seq = 0;
/** Insert one analysed game. `stream` and `hasClockData` ride on the fields. */
async function seedGame(
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
      analysisStatus: 'complete',
      ...fields,
    })
    .returning({ id: game.id });
  return row!.id;
}

/** Attach one mistake per entry, in a stated phase. */
async function addMistakes(
  gameId: string,
  rows: { phase: Phase; cpLoss: number; ply: number }[],
): Promise<void> {
  if (rows.length === 0) return;
  await harness.db.insert(mistake).values(
    rows.map((r) => ({
      gameId,
      ply: r.ply,
      moveNumber: Math.ceil(r.ply / 2),
      movingColor: 'white' as const,
      fen: START_FEN,
      moveSan: 'e4',
      bestMoveSan: 'd4',
      judgement: 'mistake' as const,
      cpLoss: r.cpLoss,
      winProbDrop: 0.2,
      phase: r.phase,
    })),
  );
}

interface ClockedMove {
  ply: number;
  clockMs: number;
  isMistake: boolean;
}

/**
 * Seed one clocked online game for a white player, with `move_ply` rows for the
 * player's odd plies only and a `mistake` row where `isMistake` is true. The
 * opponent's plies are irrelevant: the query filters by colour parity.
 */
async function seedClockedGame(
  playerId: string,
  moves: ClockedMove[],
  stream: 'online' | 'tournament' = 'online',
): Promise<string> {
  const gameId = await seedGame(playerId, {
    stream,
    hasClockData: true,
    playerColor: 'white',
  });

  await harness.db.insert(movePly).values(
    moves.map((m) => ({
      gameId,
      ply: m.ply,
      san: 'e4',
      uci: 'e2e4',
      fenBefore: START_FEN,
      clockMs: m.clockMs,
    })),
  );

  const flagged = moves.filter((m) => m.isMistake);
  if (flagged.length > 0) {
    await harness.db.insert(mistake).values(
      flagged.map((m) => ({
        gameId,
        ply: m.ply,
        moveNumber: Math.ceil(m.ply / 2),
        movingColor: 'white' as const,
        fen: START_FEN,
        moveSan: 'e4',
        bestMoveSan: 'd4',
        judgement: 'mistake' as const,
        cpLoss: 50,
        winProbDrop: 0.2,
      })),
    );
  }

  return gameId;
}

/** White plies 1..`count`, calm until `troubleFromPly`, mistakes at `mistakePlies`. */
function clockedMoves(
  count: number,
  troubleFromPly: number,
  mistakePlies: number[],
): ClockedMove[] {
  const moves: ClockedMove[] = [];
  for (let ply = 1; ply <= count; ply += 2) {
    moves.push({
      ply,
      clockMs: ply >= troubleFromPly ? 20_000 : 120_000,
      isMistake: mistakePlies.includes(ply),
    });
  }
  return moves;
}

interface PhaseReportBody {
  playerId: string;
  stream: string;
  phases: { phase: string; totalCpLoss: number; games: number }[];
  mistakeCount: number;
  timeTrouble:
    | {
        status: 'reported';
        clockedGames: number;
        fromMove: number;
        troubleMoves: number;
        troubleMistakeRate: number;
        calmMoves: number;
        calmMistakeRate: number;
      }
    | { status: 'unavailable'; reason: string };
}

describe('GET /players/{playerId}/phase', () => {
  test('aggregates loss by phase, zero-fills empty phases, and says no_clock_data for tournament', async () => {
    const playerId = await makePlayer(OWNER);
    await addMistakes(await seedGame(playerId), [
      { phase: 'opening', cpLoss: 100, ply: 3 },
      { phase: 'opening', cpLoss: 200, ply: 5 },
      { phase: 'middlegame', cpLoss: 150, ply: 25 },
      { phase: 'middlegame', cpLoss: 150, ply: 27 },
      { phase: 'middlegame', cpLoss: 150, ply: 29 },
    ]);

    const res = await get(OWNER, playerId, 'tournament');
    expect(res.status).toBe(200);
    const body = (await res.json()) as PhaseReportBody;
    expect(body.phases).toEqual([
      { phase: 'opening', totalCpLoss: 300, games: 1 },
      { phase: 'middlegame', totalCpLoss: 450, games: 1 },
      { phase: 'endgame', totalCpLoss: 0, games: 0 },
    ]);
    expect(body.mistakeCount).toBe(5);
    expect(body.timeTrouble).toEqual({ status: 'unavailable', reason: 'no_clock_data' });
  });

  test('never blends streams', async () => {
    const playerId = await makePlayer(OWNER);
    await addMistakes(await seedGame(playerId, { stream: 'online' }), [
      { phase: 'endgame', cpLoss: 300, ply: 80 },
    ]);
    await addMistakes(await seedGame(playerId, { stream: 'tournament' }), [
      { phase: 'opening', cpLoss: 100, ply: 3 },
    ]);

    const online = (await (await get(OWNER, playerId, 'online')).json()) as PhaseReportBody;
    const tournament = (await (await get(OWNER, playerId, 'tournament')).json()) as PhaseReportBody;
    expect(online.phases.find((p) => p.phase === 'endgame')).toEqual({
      phase: 'endgame',
      totalCpLoss: 300,
      games: 1,
    });
    expect(tournament.phases.find((p) => p.phase === 'opening')).toEqual({
      phase: 'opening',
      totalCpLoss: 100,
      games: 1,
    });
  });

  test('a player with no analysed games in the stream answers 422', async () => {
    const playerId = await makePlayer(OWNER);
    await addMistakes(await seedGame(playerId, { stream: 'online' }), [
      { phase: 'opening', cpLoss: 100, ply: 3 },
    ]);

    const res = await get(OWNER, playerId, 'tournament');
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('not_enough_evidence');
  });

  test('reports time trouble once clocked games and trouble moves hold', async () => {
    const playerId = await makePlayer(OWNER);
    for (let g = 0; g < 3; g++) {
      await seedClockedGame(playerId, clockedMoves(15, 7, [7, 9, 11]));
    }

    const res = await get(OWNER, playerId, 'online');
    expect(res.status).toBe(200);
    const body = (await res.json()) as PhaseReportBody;
    expect(body.timeTrouble).toEqual({
      status: 'reported',
      clockedGames: 3,
      fromMove: 4,
      troubleMoves: 15,
      troubleMistakeRate: 0.6,
      calmMoves: 9,
      calmMistakeRate: 0,
    });
  });

  test('reports time trouble for classical games that carry clock data, apart from online', async () => {
    const playerId = await makePlayer(OWNER);
    for (let g = 0; g < 3; g++) {
      await seedClockedGame(playerId, clockedMoves(15, 7, [7, 9, 11]), 'tournament');
    }
    // An online clocked game that the tournament query must not count.
    await seedClockedGame(playerId, clockedMoves(15, 999, []));

    const res = await get(OWNER, playerId, 'tournament');
    expect(res.status).toBe(200);
    const body = (await res.json()) as PhaseReportBody;
    expect(body.timeTrouble).toEqual({
      status: 'reported',
      clockedGames: 3,
      fromMove: 4,
      troubleMoves: 15,
      troubleMistakeRate: 0.6,
      calmMoves: 9,
      calmMistakeRate: 0,
    });
  });

  test('online games with no clock data answer no_clock_data, with the phase half intact', async () => {
    const playerId = await makePlayer(OWNER);
    await addMistakes(await seedGame(playerId, { stream: 'online' }), [
      { phase: 'opening', cpLoss: 100, ply: 3 },
    ]);

    const res = await get(OWNER, playerId, 'online');
    expect(res.status).toBe(200);
    const body = (await res.json()) as PhaseReportBody;
    expect(body.timeTrouble).toEqual({ status: 'unavailable', reason: 'no_clock_data' });
    expect(body.phases[0]).toEqual({ phase: 'opening', totalCpLoss: 100, games: 1 });
  });

  test('too few clocked games answers not_enough_evidence', async () => {
    const playerId = await makePlayer(OWNER);
    for (let g = 0; g < 2; g++) {
      await seedClockedGame(playerId, clockedMoves(15, 7, [7, 9, 11]));
    }

    const res = await get(OWNER, playerId, 'online');
    expect(res.status).toBe(200);
    const body = (await res.json()) as PhaseReportBody;
    expect(body.timeTrouble).toEqual({ status: 'unavailable', reason: 'not_enough_evidence' });
  });

  test('too few moves below the clock threshold answers not_enough_evidence', async () => {
    const playerId = await makePlayer(OWNER);
    // Three clocked games, but every move is calm: nothing crosses the threshold.
    for (let g = 0; g < 3; g++) {
      await seedClockedGame(playerId, clockedMoves(9, 999, []));
    }

    const res = await get(OWNER, playerId, 'online');
    expect(res.status).toBe(200);
    const body = (await res.json()) as PhaseReportBody;
    expect(body.timeTrouble).toEqual({ status: 'unavailable', reason: 'not_enough_evidence' });
  });

  test('a second user with no claim answers 403', async () => {
    const playerId = await makePlayer(OWNER);
    await addMistakes(await seedGame(playerId), [{ phase: 'opening', cpLoss: 100, ply: 3 }]);

    const res = await get(OTHER, playerId, 'tournament');
    expect(res.status).toBe(403);
  });
});

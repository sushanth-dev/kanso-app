/**
 * The round-decay endpoint against a real PostgreSQL, with fixture games and
 * mistakes in the real tables. The scoring is unit-tested in
 * round-decay.test.ts; this covers what only a database proves: the per-round
 * grouping, the analysed-only filter, the too-thin refusal, the absent round,
 * and that a second player's claim is refused.
 */
import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { game, mistake, player, tournament } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';

let harness: IntegrationDatabase;
const OWNER = 'user_owner';
const OTHER = 'user_other';

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

async function get(userId: string | null, tournamentId: string) {
  return app(userId).request(`/tournaments/${tournamentId}/round-decay`);
}

async function makePlayer(ownerId: string): Promise<string> {
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: ownerId, displayName: 'Test Player' })
    .returning({ id: player.id });
  return row!.id;
}

async function seedTournament(playerId: string): Promise<string> {
  const [t] = await harness.db
    .insert(tournament)
    .values({ playerId, name: 'Autumn Open', key: 'autumn open' })
    .returning({ id: tournament.id });
  return t!.id;
}

let seq = 0;
/** Insert one analysed game in a round. `moveCount` is the total ply count (40 → 20 player plies). */
async function seedGame(
  tournamentId: string,
  playerId: string,
  overrides: {
    round?: number;
    moveCount?: number;
    playerColor?: 'white' | 'black';
    analysisStatus?: 'pending' | 'complete';
  } = {},
): Promise<string> {
  const [row] = await harness.db
    .insert(game)
    .values({
      playerId,
      tournamentId,
      stream: 'tournament',
      source: 'pgn_upload',
      pgnHash: `hash_${playerId}_${seq++}`,
      pgn: '[Result "1-0"]\n\n1. e4 e5 1-0',
      result: '1-0',
      round: overrides.round ?? null,
      moveCount: overrides.moveCount ?? 40,
      playerColor: overrides.playerColor ?? 'white',
      analysisStatus: overrides.analysisStatus ?? 'complete',
    })
    .returning({ id: game.id });
  return row!.id;
}

/** Attach one mistake per centipawn loss in the list. Only `cpLoss` matters to the aggregation. */
async function addMistakes(gameId: string, losses: number[]): Promise<void> {
  if (losses.length === 0) return;
  await harness.db.insert(mistake).values(
    losses.map((cpLoss, i) => ({
      gameId,
      ply: i + 1,
      moveNumber: i + 1,
      movingColor: 'white' as const,
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      moveSan: 'e4',
      bestMoveSan: 'd4',
      judgement: 'mistake' as const,
      cpLoss,
      winProbDrop: 0.2,
    })),
  );
}

interface RoundDecayBody {
  tournamentId: string;
  rounds: { round: number; games: number; mistakes: number; lossPerMove: number | null }[];
  roundCount: number;
}

describe('GET /tournaments/{tournamentId}/round-decay', () => {
  test('reports the average centipawn loss per move, grouped by round', async () => {
    const playerId = await makePlayer(OWNER);
    const tournamentId = await seedTournament(playerId);

    // Round 1: three games, two mistakes totalling 300 cp over 60 player moves.
    const r1g1 = await seedGame(tournamentId, playerId, { round: 1 });
    await seedGame(tournamentId, playerId, { round: 1 });
    await seedGame(tournamentId, playerId, { round: 1 });
    await addMistakes(r1g1, [100, 200]);

    // Round 2: three games, no mistakes → a clean zero, not absent.
    await seedGame(tournamentId, playerId, { round: 2 });
    await seedGame(tournamentId, playerId, { round: 2 });
    await seedGame(tournamentId, playerId, { round: 2 });

    // Round 3: three games, one mistake of 120 cp.
    const r3g1 = await seedGame(tournamentId, playerId, { round: 3 });
    await seedGame(tournamentId, playerId, { round: 3 });
    await seedGame(tournamentId, playerId, { round: 3 });
    await addMistakes(r3g1, [120]);

    const res = await get(OWNER, tournamentId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as RoundDecayBody;
    expect(body.roundCount).toBe(3);
    expect(body.rounds).toEqual([
      { round: 1, games: 3, mistakes: 2, lossPerMove: 5 },
      { round: 2, games: 3, mistakes: 0, lossPerMove: 0 },
      { round: 3, games: 3, mistakes: 1, lossPerMove: 2 },
    ]);
  });

  test('refuses with 422 when the tournament has fewer than two rounds', async () => {
    const playerId = await makePlayer(OWNER);
    const tournamentId = await seedTournament(playerId);
    await seedGame(tournamentId, playerId, { round: 1 });
    await seedGame(tournamentId, playerId, { round: 1 });
    await seedGame(tournamentId, playerId, { round: 1 });

    const res = await get(OWNER, tournamentId);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_enough_evidence');
  });

  test('refuses with 422 when any round has fewer than three games', async () => {
    const playerId = await makePlayer(OWNER);
    const tournamentId = await seedTournament(playerId);
    for (let i = 0; i < 3; i++) await seedGame(tournamentId, playerId, { round: 1 });
    for (let i = 0; i < 2; i++) await seedGame(tournamentId, playerId, { round: 2 });

    const res = await get(OWNER, tournamentId);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_enough_evidence');
  });

  test('a round with no games is absent from the line, not a zero point', async () => {
    const playerId = await makePlayer(OWNER);
    const tournamentId = await seedTournament(playerId);
    for (let i = 0; i < 3; i++) await seedGame(tournamentId, playerId, { round: 1 });
    for (let i = 0; i < 3; i++) await seedGame(tournamentId, playerId, { round: 3 });

    const res = await get(OWNER, tournamentId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as RoundDecayBody;
    expect(body.rounds.map((r) => r.round)).toEqual([1, 3]);
  });

  test('an unanalysed game does not count toward a round’s evidence', async () => {
    const playerId = await makePlayer(OWNER);
    const tournamentId = await seedTournament(playerId);
    for (let i = 0; i < 3; i++) await seedGame(tournamentId, playerId, { round: 1 });
    await seedGame(tournamentId, playerId, { round: 1, analysisStatus: 'pending' });
    for (let i = 0; i < 3; i++) await seedGame(tournamentId, playerId, { round: 2 });

    const res = await get(OWNER, tournamentId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as RoundDecayBody;
    expect(body.rounds[0]!.games).toBe(3);
  });

  test('a second user with no claim answers 403', async () => {
    const playerId = await makePlayer(OWNER);
    const tournamentId = await seedTournament(playerId);
    for (let i = 0; i < 3; i++) await seedGame(tournamentId, playerId, { round: 1 });
    for (let i = 0; i < 3; i++) await seedGame(tournamentId, playerId, { round: 2 });

    const res = await get(OTHER, tournamentId);
    expect(res.status).toBe(403);
  });
});

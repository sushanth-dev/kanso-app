import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { user } from '../db/auth-schema.ts';
import { game, mistake, movePly, player, report } from '../db/schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';

let harness: IntegrationDatabase;
const OWNER = 'user_owner';
const OTHER = 'user_other';

const FEN = 'rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 3';

const sessionFor = (userId: string) => () => ({ userId });

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
});

function app(userId: string | null) {
  return createApp({
    db: harness.db,
    getSession: (userId == null ? () => null : sessionFor(userId)) as (c: Context) => unknown,
  });
}

/** A player, an analyzed game, two plies and one mistake, all owned by `ownerId`. */
async function seedReviewedGame(ownerId: string): Promise<string> {
  await harness.db
    .insert(user)
    .values([
      { id: OWNER, name: 'Owner', email: 'owner@example.com', emailVerified: true },
      { id: OTHER, name: 'Other', email: 'other@example.com', emailVerified: true },
    ])
    .onConflictDoNothing();
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: ownerId, displayName: 'Test Player' })
    .returning({ id: player.id });
  const [created] = await harness.db
    .insert(game)
    .values({
      playerId: row!.id,
      stream: 'tournament',
      source: 'pgn_upload',
      pgnHash: `hash_${ownerId}`,
      pgn: '[Result "0-1"]\n\n1. e4 e5 2. Nf3 Qf6 3. Nc3 Qxf3 0-1',
      result: '0-1',
      playerColor: 'black',
      analysisStatus: 'complete',
    })
    .returning({ id: game.id });
  const gameId = created!.id;

  await harness.db.insert(movePly).values([
    {
      gameId,
      ply: 6,
      san: 'Qf6',
      uci: 'd8f6',
      fenBefore: FEN,
      phase: 'opening',
      evalCp: 30,
      evalMate: null,
      bestMoveSan: 'Nc6',
      bestMoveUci: 'b8c6',
      clockMs: null,
      moveTimeMs: null,
    },
    {
      gameId,
      ply: 8,
      san: 'Qxf3',
      uci: 'f6f3',
      fenBefore: FEN,
      phase: 'opening',
      evalCp: -200,
      evalMate: null,
      bestMoveSan: 'd6',
      bestMoveUci: 'd7d6',
      clockMs: null,
      moveTimeMs: null,
    },
  ]);

  await harness.db.insert(mistake).values({
    gameId,
    ply: 6,
    moveNumber: 3,
    movingColor: 'black',
    phase: 'opening',
    fen: FEN,
    moveSan: 'Qf6',
    bestMoveSan: 'Nc6',
    evalBeforeCp: 30,
    evalBeforeMate: null,
    evalAfterCp: -200,
    evalAfterMate: null,
    judgement: 'blunder',
    cpLoss: 230,
    winProbDrop: 0.4,
    motif: 'hanging_piece',
  });

  return gameId;
}

describe('GET /games/{gameId}', () => {
  test('returns the game with plies and mistakes', async () => {
    const gameId = await seedReviewedGame(OWNER);
    const res = await app(OWNER).request(`/games/${gameId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      pgn: string;
      result: string;
      playerColor: string;
      plies: { ply: number; uci: string; bestMoveUci: string | null }[];
      mistakes: { ply: number; bestMoveSan: string; cpLoss: number; explanation: string | null }[];
    };
    expect(body.id).toBe(gameId);
    expect(body.pgn).toContain('0-1');
    expect(body.result).toBe('0-1');
    expect(body.playerColor).toBe('black');
    expect(body.plies).toHaveLength(2);
    expect(body.plies[0]).toMatchObject({ ply: 6, uci: 'd8f6', bestMoveUci: 'b8c6' });
    expect(body.plies[1]).toMatchObject({ ply: 8, bestMoveUci: 'd7d6' });
    expect(body.mistakes).toHaveLength(1);
    expect(body.mistakes[0]).toMatchObject({
      ply: 6,
      bestMoveSan: 'Nc6',
      cpLoss: 230,
      explanation: null,
    });
  });

  test('answers 401 with no session', async () => {
    const gameId = await seedReviewedGame(OWNER);
    const res = await app(null).request(`/games/${gameId}`);
    expect(res.status).toBe(401);
  });

  test('answers 403 for a game belonging to another account’s player', async () => {
    const gameId = await seedReviewedGame(OWNER);
    const res = await app(OTHER).request(`/games/${gameId}`);
    expect(res.status).toBe(403);
  });

  test('answers 404 for a game that does not exist', async () => {
    await seedReviewedGame(OWNER);
    const res = await app(OWNER).request('/games/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });

  test('ST-105: opening a completed game records no streak activity', async () => {
    const gameId = await seedReviewedGame(OWNER);
    const [row0] = await harness.db
      .select({ playerId: game.playerId })
      .from(game)
      .where(eq(game.id, gameId));
    const playerId = row0!.playerId;

    await app(OWNER).request(`/games/${gameId}`);

    const [row] = await harness.db.select().from(player).where(eq(player.id, playerId));
    expect(row!.currentStreak).toBe(0);
    expect(row!.xp).toBe(0);
    expect(row!.lastActivityDate).toBeNull();
  });

  test('ST-149: a mistake carries opponentElo and severity, weighted by the opponent\u2019s Elo', async () => {
    const gameId = await seedReviewedGame(OWNER);
    // The seeded game has the owner playing black, so white's Elo is the
    // opponent's; a 2000-rated opponent should weight the mistake above its
    // raw cpLoss.
    await harness.db.update(game).set({ whiteElo: 2000 }).where(eq(game.id, gameId));

    const res = await app(OWNER).request(`/games/${gameId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mistakes: { cpLoss: number; opponentElo: number | null; severity: number }[];
    };
    expect(body.mistakes[0]).toMatchObject({ cpLoss: 230, opponentElo: 2000 });
    expect(body.mistakes[0]!.severity).toBeGreaterThan(body.mistakes[0]!.cpLoss);
  });

  test('ST-149: opponentElo is null and severity equals cpLoss when the game has no Elo headers', async () => {
    const gameId = await seedReviewedGame(OWNER);
    const res = await app(OWNER).request(`/games/${gameId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mistakes: { cpLoss: number; opponentElo: number | null; severity: number }[];
    };
    expect(body.mistakes[0]).toMatchObject({ cpLoss: 230, opponentElo: null, severity: 230 });
  });

  test('ST-121: serves the newest stored stream report\u2019s onset, null without one', async () => {
    const gameId = await seedReviewedGame(OWNER);
    const [row] = await harness.db
      .select({ playerId: game.playerId })
      .from(game)
      .where(eq(game.id, gameId));

    // No report row yet: the onset is absent, and the read never regenerates.
    const before = await app(OWNER).request(`/games/${gameId}`);
    const beforeBody = (await before.json()) as { timeTroubleFromMove: number | null };
    expect(beforeBody.timeTroubleFromMove).toBeNull();

    // Two stored reports: the read takes the newest row, never recomputing.
    await harness.db.insert(report).values([
      {
        playerId: row!.playerId,
        stream: 'tournament',
        tournamentId: null,
        gamesCovered: 2,
        timeTroubleFromMove: 20,
        timeTroubleReason: null,
        generatedAt: new Date(Date.now() - 60_000),
      },
      {
        playerId: row!.playerId,
        stream: 'tournament',
        tournamentId: null,
        gamesCovered: 3,
        timeTroubleFromMove: 31,
        timeTroubleReason: null,
      },
    ]);

    const res = await app(OWNER).request(`/games/${gameId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { timeTroubleFromMove: number | null };
    expect(body.timeTroubleFromMove).toBe(31);
  });
});

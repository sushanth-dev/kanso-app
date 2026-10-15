import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { game, movePly, player, tournament } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';

let harness: IntegrationDatabase;
const OWNER = 'user_owner_pgn';
const OTHER = 'user_other_pgn';

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

async function makePlayer(ownerId: string): Promise<string> {
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: ownerId, displayName: 'Test Player' })
    .returning({ id: player.id });
  return row!.id;
}

describe('export endpoints', () => {
  test('exportGamePgn returns 200 with annotated PGN and attachment header', async () => {
    const playerId = await makePlayer(OWNER);
    const [g] = await harness.db
      .insert(game)
      .values({
        playerId,
        stream: 'tournament',
        source: 'pgn_upload',
        pgnHash: 'hash_test_1',
        pgn: '1. e4 e5 1-0',
        result: '1-0',
        whiteName: 'Alice',
        blackName: 'Bob',
      })
      .returning({ id: game.id });

    await harness.db.insert(movePly).values([
      {
        gameId: g!.id,
        ply: 1,
        san: 'e4',
        uci: 'e2e4',
        fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        evalCp: 20,
      },
      {
        gameId: g!.id,
        ply: 2,
        san: 'e5',
        uci: 'e7e5',
        fenBefore: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
        evalCp: 25,
      },
    ]);

    const res = await app(OWNER).request(`/games/${g!.id}/export.pgn`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-chess-pgn');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('content-disposition')).toContain('Alice_vs_Bob.pgn');

    const body = await res.text();
    expect(body).toContain('[White "Alice"]');
    expect(body).toContain('[Black "Bob"]');
    expect(body).toContain('1. e4');
    expect(body).toContain('[%eval +0.20]');
  });

  test('exportGamePgn rejects unauthorized access with 401 or 403', async () => {
    const playerId = await makePlayer(OWNER);
    const [g] = await harness.db
      .insert(game)
      .values({
        playerId,
        stream: 'tournament',
        source: 'pgn_upload',
        pgnHash: 'hash_test_2',
        pgn: '1. e4 e5 1-0',
        result: '1-0',
      })
      .returning({ id: game.id });

    // 401 unauthenticated
    const anonRes = await app(null).request(`/games/${g!.id}/export.pgn`);
    expect(anonRes.status).toBe(401);

    // 403 not owner
    const otherRes = await app(OTHER).request(`/games/${g!.id}/export.pgn`);
    expect(otherRes.status).toBe(403);

    // 404 nonexistent
    const missingRes = await app(OWNER).request(
      '/games/00000000-0000-4000-8000-000000000099/export.pgn',
    );
    expect(missingRes.status).toBe(404);
  });

  test('exportTournamentPgn exports all games in round order', async () => {
    const playerId = await makePlayer(OWNER);
    const [t] = await harness.db
      .insert(tournament)
      .values({ playerId, name: 'State Championship', key: 'state championship' })
      .returning({ id: tournament.id });

    await harness.db
      .insert(game)
      .values([
        {
          playerId,
          tournamentId: t!.id,
          stream: 'tournament',
          source: 'pgn_upload',
          pgnHash: 'hash_t_1',
          pgn: '1. e4 e5 1-0',
          result: '1-0',
          round: 1,
          whiteName: 'Player1',
          blackName: 'Player2',
        },
        {
          playerId,
          tournamentId: t!.id,
          stream: 'tournament',
          source: 'pgn_upload',
          pgnHash: 'hash_t_2',
          pgn: '1. d4 d5 0-1',
          result: '0-1',
          round: 2,
          whiteName: 'Player3',
          blackName: 'Player1',
        },
      ])
      .returning({ id: game.id });

    const res = await app(OWNER).request(`/tournaments/${t!.id}/export.pgn`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-chess-pgn');
    expect(res.headers.get('content-disposition')).toContain('State_Championship.pgn');

    const body = await res.text();
    expect(body).toContain('[Round "1"]');
    expect(body).toContain('[Round "2"]');
    expect(body).toContain('[White "Player1"]');
    expect(body).toContain('[White "Player3"]');
  });
});

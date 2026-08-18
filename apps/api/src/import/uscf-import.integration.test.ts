/**
 * ST-041. Importing published tournament games by USCF tournament and player
 * name, end to end against a real PostgreSQL, with the provider fetch stubbed
 * behind the `gameFetcher` seam.
 *
 * The fake returns crosstable-shaped header-only PGNs, so the parse, validate,
 * and store path is exercised for real while no outbound call is made. The unit
 * tests cover the provider's parse and synthesis; this file covers what happens
 * to the games once they are in the door.
 */
import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createApp } from '../app.ts';
import { player } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import type { GameFetcher } from './game-fetcher.ts';

let harness: IntegrationDatabase;
const OWNER = 'user_owner';
const OTHER = 'user_other';

const sessionFor = (userId: string) => () => ({ userId });

const gameFetcher = {
  chesscom: vi.fn<GameFetcher['chesscom']>(),
  lichess: vi.fn<GameFetcher['lichess']>(),
  uscf: vi.fn<GameFetcher['uscf']>(),
};

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
  gameFetcher.uscf.mockReset();
});

async function seedPlayer(displayName = 'Test Player'): Promise<string> {
  await harness.db
    .insert(user)
    .values([
      { id: OWNER, name: 'Owner', email: 'owner@example.com', emailVerified: true },
      { id: OTHER, name: 'Other', email: 'other@example.com', emailVerified: true },
    ])
    .onConflictDoNothing();
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: OWNER, displayName })
    .returning({ id: player.id });
  return row!.id;
}

function app(userId: string | null) {
  return createApp({
    db: harness.db,
    getSession: (userId == null ? () => null : sessionFor(userId)) as (c: Context) => unknown,
    gameFetcher,
  });
}

async function importByTournament(userId: string | null, playerId: string, body: unknown) {
  return app(userId).request(`/players/${playerId}/imports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** A result-only game: a header-only PGN with no movetext. */
function crosstableGame(
  externalId: string,
  round: number,
  white: string,
  black: string,
  result: string,
) {
  return {
    externalId,
    pgn: `[Event "Event"]\n[Site "USCF"]\n[Round "${round}"]\n[White "${white}"]\n[Black "${black}"]\n[Result "${result}"]\n\n`,
  };
}

describe('POST /players/{playerId}/imports (uscf)', () => {
  test('stores result-only games tagged tournament, failed analysis, no moves', async () => {
    const playerId = await seedPlayer('Test Player');
    gameFetcher.uscf.mockResolvedValue({
      ok: true,
      games: [
        crosstableGame('tid:1', 1, 'Player, Test', 'Smith, John', '1-0'),
        crosstableGame('tid:2', 2, 'Doe, Jane', 'Player, Test', '1/2-1/2'),
      ],
    });

    const res = await importByTournament(OWNER, playerId, {
      source: 'uscf',
      tournamentName: 'Event',
      playerName: 'Test Player',
      stream: 'tournament',
    });
    expect(res.status).toBe(202);
    const job = (await res.json()) as { source: string; stream: string; gamesImported: number };
    expect(job.source).toBe('uscf');
    expect(job.stream).toBe('tournament');
    expect(job.gamesImported).toBe(2);

    const rows = await harness.sql`
      SELECT source, stream, move_count, analysis_status, analysis_error, player_color
      FROM game WHERE player_id = ${playerId} ORDER BY round`;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      source: 'uscf',
      stream: 'tournament',
      move_count: 0,
      analysis_status: 'failed',
      analysis_error: 'no moves',
      player_color: 'white',
    });
    expect(rows[1]!.player_color).toBe('black');

    const tournaments =
      await harness.sql`SELECT name FROM tournament WHERE player_id = ${playerId}`;
    expect(tournaments).toHaveLength(1);
    expect(tournaments[0]!.name).toBe('Event');
  });

  test('refuses a near-miss name with the reason', async () => {
    const playerId = await seedPlayer('Test Player');
    gameFetcher.uscf.mockResolvedValue({
      ok: false,
      code: 'name_mismatch',
      detail:
        'This tournament lists a Player but not Test Player; check the spelling.',
    });

    const res = await importByTournament(OWNER, playerId, {
      source: 'uscf',
      tournamentName: 'Event',
      playerName: 'Test Player',
      stream: 'tournament',
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'name_mismatch',
      message:
        'This tournament lists a Player but not Test Player; check the spelling.',
    });
  });

  test('refuses an unresolved tournament name', async () => {
    const playerId = await seedPlayer('Test Player');
    gameFetcher.uscf.mockResolvedValue({ ok: false, code: 'tournament_not_found' });

    const res = await importByTournament(OWNER, playerId, {
      source: 'uscf',
      tournamentName: 'No Such Event',
      playerName: 'Test Player',
      stream: 'tournament',
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'tournament_not_found' });
  });
});

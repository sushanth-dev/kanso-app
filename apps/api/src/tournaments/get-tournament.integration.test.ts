import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { player, tournament } from '../db/schema.ts';
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
  return app(userId).request(`/tournaments/${tournamentId}`);
}

async function makePlayer(ownerId: string): Promise<string> {
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: ownerId, displayName: 'Sushanth Kamabathula' })
    .returning({ id: player.id });
  return row.id;
}

interface GameRow {
  id: string;
  round: number | null;
  board: number | null;
  opponent: string | null;
  playerColor: 'white' | 'black' | null;
  result: 'win' | 'draw' | 'loss' | null;
  analysed: boolean;
}

interface TournamentDetailBody {
  id: string;
  name: string;
  site: string | null;
  startedAt: string | null;
  endedAt: string | null;
  games: GameRow[];
  score: number;
  scoreGames: number;
  scoreExcluded: number;
}

let seq = 0;
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

/** Insert a game attached to a tournament with the given overrides. */
async function seedGame(
  tournamentId: string,
  playerId: string,
  overrides: {
    round?: number | null;
    board?: number | null;
    playerColor?: 'white' | 'black' | null;
    result?: '1-0' | '0-1' | '1/2-1/2' | '*';
    whiteName?: string | null;
    blackName?: string | null;
    analysisStatus?: 'pending' | 'complete';
  } = {},
): Promise<void> {
  await harness.sql`
    INSERT INTO game (
      player_id, tournament_id, stream, source, pgn_hash, pgn, result,
      round, board, player_color, white_name, black_name, analysis_status
    ) VALUES (
      ${playerId}, ${tournamentId}, 'tournament', 'pgn_upload',
      ${`hash_${playerId}_${seq++}`}, 'pgn',
      ${overrides.result ?? '1-0'},
      ${overrides.round ?? null},
      ${overrides.board ?? null},
      ${overrides.playerColor ?? null},
      ${overrides.whiteName ?? 'White Player'},
      ${overrides.blackName ?? 'Black Player'},
      ${overrides.analysisStatus ?? 'pending'}
    )
  `;
}

describe('GET /tournaments/{tournamentId}', () => {
  test('returns the games in round order, then board order, with unnumbered games last', async () => {
    const mine = await makePlayer(OWNER);
    const t = await seedTournament(mine);
    await seedGame(t, mine, { round: 2, board: 1, playerColor: 'white' });
    await seedGame(t, mine, { round: 1, board: 2, playerColor: 'black' });
    await seedGame(t, mine, { round: 1, board: 1, playerColor: 'white' });
    await seedGame(t, mine, { round: null, board: null, playerColor: 'white' });

    const body = (await (await get(OWNER, t)).json()) as TournamentDetailBody;
    // Round 1 board 1, round 1 board 2, round 2 board 1, then the unnumbered one last.
    expect(body.games.map((g) => [g.round, g.board])).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
      [null, null],
    ]);
  });

  test('names the opponent from the side the player is not on', async () => {
    const mine = await makePlayer(OWNER);
    const t = await seedTournament(mine);
    await seedGame(t, mine, {
      playerColor: 'white',
      whiteName: 'Sushanth Kamabathula',
      blackName: 'Rival One',
    });
    await seedGame(t, mine, {
      playerColor: 'black',
      whiteName: 'Rival Two',
      blackName: 'Sushanth Kamabathula',
    });

    const body = (await (await get(OWNER, t)).json()) as TournamentDetailBody;
    expect(body.games.map((g) => g.opponent)).toEqual(['Rival One', 'Rival Two']);
  });

  test('gives the result from the player’s point of view', async () => {
    const mine = await makePlayer(OWNER);
    const t = await seedTournament(mine);
    // Player is white, white won -> win.
    await seedGame(t, mine, { playerColor: 'white', result: '1-0' });
    // Player is black, white won -> loss.
    await seedGame(t, mine, { playerColor: 'black', result: '1-0' });
    // Draw.
    await seedGame(t, mine, { playerColor: 'white', result: '1/2-1/2' });

    const body = (await (await get(OWNER, t)).json()) as TournamentDetailBody;
    expect(body.games.map((g) => g.result)).toEqual(['win', 'loss', 'draw']);
  });

  test('counts the score only from known-side games and reports the excluded count', async () => {
    const mine = await makePlayer(OWNER);
    const t = await seedTournament(mine);
    // Two wins, one draw, one loss -> 2 + 0.5 + 0 = 2.5 over 4 games.
    await seedGame(t, mine, { playerColor: 'white', result: '1-0' });
    await seedGame(t, mine, { playerColor: 'black', result: '0-1' });
    await seedGame(t, mine, { playerColor: 'white', result: '1/2-1/2' });
    await seedGame(t, mine, { playerColor: 'black', result: '1-0' });
    // Side undecided -> excluded from the score.
    await seedGame(t, mine, { playerColor: null, result: '1-0' });

    const body = (await (await get(OWNER, t)).json()) as TournamentDetailBody;
    expect(body.score).toBe(2.5);
    expect(body.scoreGames).toBe(4);
    expect(body.scoreExcluded).toBe(1);
    // The excluded game has no result or opponent.
    const excluded = body.games.find((g) => g.playerColor === null)!;
    expect(excluded.result).toBeNull();
    expect(excluded.opponent).toBeNull();
  });

  test('marks a game analysed only when its analysis is complete', async () => {
    const mine = await makePlayer(OWNER);
    const t = await seedTournament(mine);
    await seedGame(t, mine, { analysisStatus: 'complete' });
    await seedGame(t, mine, { analysisStatus: 'pending' });

    const body = (await (await get(OWNER, t)).json()) as TournamentDetailBody;
    expect(body.games.map((g) => g.analysed)).toEqual([true, false]);
  });

  test('answers 401 with no session', async () => {
    const mine = await makePlayer(OWNER);
    const t = await seedTournament(mine);
    expect((await get(null, t)).status).toBe(401);
  });

  test('answers 403 for a second real player’s tournament', async () => {
    const theirs = await makePlayer(OTHER);
    const t = await seedTournament(theirs);
    await seedGame(t, theirs, { playerColor: 'white' });
    expect((await get(OWNER, t)).status).toBe(403);
  });

  test('answers 403 for a tournament that does not exist, not 404', async () => {
    const res = await get(OWNER, '00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(403);
  });
});

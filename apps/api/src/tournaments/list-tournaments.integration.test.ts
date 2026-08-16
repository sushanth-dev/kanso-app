import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { player, tournament } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';

let harness: IntegrationDatabase;
const OWNER = 'user_owner';
const OTHER = 'user_other';
const GUARDIAN = 'user_guardian';

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
    { id: GUARDIAN, name: 'Guardian', email: 'guardian@example.com', emailVerified: true },
  ]);
});

function app(userId: string | null) {
  return createApp({
    db: harness.db,
    getSession: (userId == null ? () => null : sessionFor(userId)) as (c: Context) => unknown,
  });
}

async function list(userId: string | null, playerId: string) {
  return app(userId).request(`/players/${playerId}/tournaments`);
}

async function makePlayer(ownerId: string): Promise<string> {
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: ownerId, displayName: 'Test Player' })
    .returning({ id: player.id });
  return row!.id;
}

interface TournamentRow {
  id: string;
  name: string;
  site: string | null;
  startedAt: string | null;
  endedAt: string | null;
  gameCount: number;
  analysedCount: number;
}

interface TournamentListBody {
  tournaments: TournamentRow[];
}

let seq = 0;
/** Insert a tournament row and a game attached to it, returning the tournament id. */
async function seedTournament(
  playerId: string,
  fields: Partial<typeof tournament.$inferInsert> = {},
): Promise<string> {
  const [t] = await harness.db
    .insert(tournament)
    .values({
      playerId,
      name: 'Autumn Open',
      key: 'autumn open',
      ...fields,
    })
    .returning({ id: tournament.id });

  await harness.sql`
    INSERT INTO game (player_id, tournament_id, stream, source, pgn_hash, pgn, result, analysis_status)
    VALUES (${playerId}, ${t!.id}, 'tournament', 'pgn_upload', ${`hash_${playerId}_${seq++}`}, 'pgn', '1-0', 'pending')
  `;
  return t!.id;
}

describe('GET /players/{playerId}/tournaments', () => {
  test('returns the player’s tournaments with game and analysed counts, most recent first', async () => {
    const mine = await makePlayer(OWNER);
    const older = await seedTournament(mine, {
      name: 'Old Open',
      startedAt: new Date('2024-01-01T00:00:00Z'),
      endedAt: new Date('2024-01-05T00:00:00Z'),
    });
    const newer = await seedTournament(mine, {
      name: 'New Open',
      startedAt: new Date('2025-01-01T00:00:00Z'),
      endedAt: new Date('2025-01-05T00:00:00Z'),
    });

    // Mark the newer tournament's game analysed.
    await harness.sql`
      UPDATE game SET analysis_status = 'complete'
      WHERE tournament_id = ${newer}
    `;

    const body = (await (await list(OWNER, mine)).json()) as TournamentListBody;
    expect(body.tournaments.map((t) => t.id)).toEqual([newer, older]);

    const newest = body.tournaments[0]!;
    expect(newest.name).toBe('New Open');
    expect(newest.gameCount).toBe(1);
    expect(newest.analysedCount).toBe(1);

    const oldest = body.tournaments[1]!;
    expect(oldest.name).toBe('Old Open');
    expect(oldest.gameCount).toBe(1);
    expect(oldest.analysedCount).toBe(0);
  });

  test('never returns another player’s tournaments', async () => {
    const mine = await makePlayer(OWNER);
    const theirs = await makePlayer(OTHER);
    const mineT = await seedTournament(mine);
    await seedTournament(theirs);

    const body = (await (await list(OWNER, mine)).json()) as TournamentListBody;
    expect(body.tournaments.map((t) => t.id)).toEqual([mineT]);
    expect(body.tournaments).toHaveLength(1);
  });

  test('gives a player with no tournaments an empty list, not a 404', async () => {
    const mine = await makePlayer(OWNER);
    const res = await list(OWNER, mine);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TournamentListBody;
    expect(body.tournaments).toEqual([]);
  });

  test('answers 401 with no session', async () => {
    const mine = await makePlayer(OWNER);
    expect((await list(null, mine)).status).toBe(401);
  });

  test('answers 403 for a second real player the session has no claim on', async () => {
    const theirs = await makePlayer(OTHER);
    await seedTournament(theirs);
    expect((await list(OWNER, theirs)).status).toBe(403);
  });

  test('answers 403 for a player that does not exist, not 404', async () => {
    const res = await list(OWNER, '00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(403);
  });
});

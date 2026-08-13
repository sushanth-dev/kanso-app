import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { player } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import { runBackfill } from './backfill.ts';

let harness: IntegrationDatabase;
const OWNER = 'user_owner';

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
});

/** Seed a player and return its id. */
async function seedPlayer(displayName = 'Test Player'): Promise<string> {
  await harness.db
    .insert(user)
    .values({ id: OWNER, name: 'Owner', email: 'owner@example.com', emailVerified: true })
    .onConflictDoNothing();
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: OWNER, displayName })
    .returning({ id: player.id });
  return row.id;
}

/** Insert a game row directly, with no tournament attached, and return its id. */
async function seedGame(
  playerId: string,
  overrides: {
    stream?: 'tournament' | 'online';
    event?: string | null;
    site?: string | null;
    playedAt?: Date | null;
  } = {},
): Promise<string> {
  const [g] = await harness.sql<{ id: string }[]>`
    INSERT INTO game (player_id, stream, source, pgn_hash, pgn, result, event, site, played_at)
    VALUES (
      ${playerId},
      ${overrides.stream ?? 'tournament'},
      'pgn_upload',
      ${`hash-${Math.random()}`},
      'pgn',
      '1-0',
      ${overrides.event ?? null},
      ${overrides.site ?? null},
      ${overrides.playedAt ? overrides.playedAt.toISOString() : null}
    )
    RETURNING id`;
  return g.id;
}

describe('runBackfill', () => {
  test('creates a tournament for unattached tournament games and reports the counts', async () => {
    const playerId = await seedPlayer();
    await seedGame(playerId, { event: 'Autumn Open 2025', site: 'Riga LAT' });
    await seedGame(playerId, { event: 'Autumn Open 2025', site: 'Riga LAT' });

    const report = await runBackfill(harness.db);

    expect(report.tournamentsCreated).toBe(1);
    expect(report.gamesAttached).toBe(2);
    expect(report.unattached).toEqual([]);

    const tournaments = await harness.sql`
      SELECT id FROM tournament WHERE player_id = ${playerId}`;
    expect(tournaments).toHaveLength(1);
    const rows = await harness.sql`
      SELECT tournament_id FROM game WHERE player_id = ${playerId}`;
    for (const row of rows) expect(row.tournament_id).toBe(tournaments[0].id);
  });

  test('is re-runnable: a second run creates nothing and attaches nothing', async () => {
    const playerId = await seedPlayer();
    await seedGame(playerId, { event: 'Autumn Open 2025', site: 'Riga LAT' });

    const first = await runBackfill(harness.db);
    expect(first.tournamentsCreated).toBe(1);

    const second = await runBackfill(harness.db);
    expect(second.tournamentsCreated).toBe(0);
    expect(second.gamesAttached).toBe(0);

    const tournaments = await harness.sql`
      SELECT id FROM tournament WHERE player_id = ${playerId}`;
    expect(tournaments).toHaveLength(1);
  });

  test('reports the tournament-stream games it could not attach and why', async () => {
    const playerId = await seedPlayer();
    await seedGame(playerId, { event: null, site: 'Riga LAT' });

    const report = await runBackfill(harness.db);

    expect(report.tournamentsCreated).toBe(0);
    expect(report.gamesAttached).toBe(0);
    expect(report.unattached).toEqual([{ reason: 'no_event', count: 1 }]);

    const [row] = await harness.sql`
      SELECT tournament_id FROM game WHERE player_id = ${playerId}`;
    expect(row.tournament_id).toBeNull();
  });

  test('leaves an online game unattached even when its event matches', async () => {
    const playerId = await seedPlayer();
    await seedGame(playerId, { event: 'Autumn Open 2025', site: 'Riga LAT' });
    await seedGame(playerId, {
      stream: 'online',
      event: 'Autumn Open 2025',
      site: 'Riga LAT',
    });

    const report = await runBackfill(harness.db);

    expect(report.tournamentsCreated).toBe(1);
    expect(report.gamesAttached).toBe(1);

    const rows = await harness.sql`
      SELECT stream, tournament_id FROM game WHERE player_id = ${playerId} ORDER BY stream`;
    const online = rows.find((r) => r.stream === 'online');
    expect(online?.tournament_id).toBeNull();
  });

  test('puts two games at the same event a year apart in two tournaments', async () => {
    const playerId = await seedPlayer();
    await seedGame(playerId, {
      event: 'Club Championship',
      site: 'Local',
      playedAt: new Date('2024-10-11T00:00:00Z'),
    });
    await seedGame(playerId, {
      event: 'Club Championship',
      site: 'Local',
      playedAt: new Date('2025-10-11T00:00:00Z'),
    });

    const report = await runBackfill(harness.db);

    expect(report.tournamentsCreated).toBe(2);
    expect(report.gamesAttached).toBe(2);

    const tournaments = await harness.sql`
      SELECT id FROM tournament WHERE player_id = ${playerId}`;
    expect(tournaments).toHaveLength(2);
  });
});

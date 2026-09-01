/**
 * ST-011 real-data verification.
 *
 * These are real games exported from lichess, covering nine files:
 * three multi-game files (test, test2, test3) and six single-game files
 * (test4..test9). They are the evidence the sprint's question is answered
 * with, not with synthetic fixtures: the grouping the identity rule produces
 * over real tournaments, including the two hard cases a fixture would not
 * have caught.
 *
 * The expected groupings were read off the PGN tags before this test was
 * written, not after, so the assertions are the rule being checked rather than
 * the rule being echoed.
 */
import { readFileSync } from 'node:fs';
import type { Context } from 'hono';
import { MAX_PGN_UPLOAD_GAMES } from './import-games.ts';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { player } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';

const real = (name: string): string =>
  readFileSync(new URL(`./fixtures/real/${name}`, import.meta.url), 'utf8');

let harness: IntegrationDatabase;
const OWNER = 'user_owner';

const sessionFor = (userId: string) => () => ({ userId });

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

async function seedPlayer(name = 'Alex Doe'): Promise<string> {
  await harness.db
    .insert(user)
    .values({ id: OWNER, name, email: 'owner@example.com', emailVerified: true })
    .onConflictDoNothing();
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: OWNER, displayName: name })
    .returning({ id: player.id });
  return row!.id;
}

function app(userId: string | null) {
  return createApp({
    db: harness.db,
    getSession: (userId == null ? () => null : sessionFor(userId)) as (c: Context) => unknown,
  });
}

async function upload(pgn: string) {
  return app(OWNER).request('/imports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'pgn_upload', stream: 'tournament', pgn }),
  });
}
/**
 * ST-096 caps a single PGN upload at 30 games, so a real file larger than
 * that now goes up in parts, split on game boundaries. test3.pgn predates
 * the cap; chunking it here is what a player splitting the file must do.
 */
function chunkPgn(pgn: string, size: number = MAX_PGN_UPLOAD_GAMES): string[] {
  const games = pgn.split(/\n\n(?=\[Event )/);
  const parts: string[] = [];
  for (let i = 0; i < games.length; i += size) {
    parts.push(games.slice(i, i + size).join('\n\n'));
  }
  return parts;
}

/** The tournaments for a player, keyed by normalised event name. */
async function tournamentsFor(playerId: string) {
  const rows = await harness.sql<{ name: string; key: string; site: string | null }[]>`
    SELECT name, key, site FROM tournament WHERE player_id = ${playerId} ORDER BY key, site`;
  return rows;
}

/** The tournament id each game resolved to, keyed by game id. */
async function gameTournaments(playerId: string) {
  const rows = await harness.sql<{ id: string; tournament_id: string | null }[]>`
    SELECT id, tournament_id FROM game WHERE player_id = ${playerId}`;
  return rows;
}

beforeEach(async () => {
  await harness.reset();
});

describe('real-data tournament grouping (ST-011)', () => {
  test('test.pgn: three tournaments, one per event', async () => {
    const playerId = await seedPlayer();
    const res = await upload(real('test.pgn'));
    expect(res.status).toBe(202);

    const tournaments = await tournamentsFor(playerId);
    expect(tournaments).toHaveLength(3);
    const keys = tournaments.map((t) => t.key).sort();
    expect(keys).toEqual([
      'biel chess festival 2025 mto',
      'fagernes international autumn 2025',
      'white horse 2025 im',
    ]);

    // Every game is attached to exactly one of the three.
    const games = await gameTournaments(playerId);
    expect(games).toHaveLength(28);
    for (const g of games) expect(g.tournament_id).not.toBeNull();
    const distinct = new Set(games.map((g) => g.tournament_id));
    expect(distinct.size).toBe(3);
  });

  test('test2.pgn: the same three tournaments plus the online blitz game', async () => {
    const playerId = await seedPlayer();
    const res = await upload(real('test2.pgn'));
    expect(res.status).toBe(202);

    const tournaments = await tournamentsFor(playerId);
    expect(tournaments).toHaveLength(4);
    const keys = tournaments.map((t) => t.key).sort();
    expect(keys).toEqual([
      'biel chess festival 2025 mto',
      'fagernes international autumn 2025',
      'rated blitz game',
      'white horse 2025 im',
    ]);

    const games = await gameTournaments(playerId);
    expect(games).toHaveLength(29);
  });

  test('test3.pgn: many tournaments, with the two hard cases grouped correctly', async () => {
    const playerId = await seedPlayer();
    // The file carries 60 games, over the upload cap, so it goes up in
    // cap-sized parts the way a player must split it. attachGames
    // reconciles each part against every tournament the player already
    // holds, so the grouping assertions read the same as a single upload.
    for (const part of chunkPgn(real('test3.pgn'))) {
      const res = await upload(part);
      expect(res.status).toBe(202);
    }

    const tournaments = await tournamentsFor(playerId);
    const games = await gameTournaments(playerId);
    expect(games).toHaveLength(60);

    // Bled-Zagreb-Belgrade spans 52 days (1959-09-07..1959-10-29): a single
    // tournament, because consecutive games are within 30 days of each other.
    const bled = tournaments.filter((t) => t.key === 'bled-zagreb-belgrade candidates');
    expect(bled).toHaveLength(1);

    // Mar del Plata spans 366 days (1959-03-30 and 1960-03-30): two annual
    // tournaments sharing a name and site, split by the 30-day window.
    const marDelPlata = tournaments.filter((t) => t.key === 'mar del plata');
    expect(marDelPlata).toHaveLength(2);

    // Every game is attached.
    for (const g of games) expect(g.tournament_id).not.toBeNull();
  });

  test('test4..test9: the four Biel games share one tournament, the others are distinct', async () => {
    const playerId = await seedPlayer();
    for (const name of [
      'test4.pgn',
      'test5.pgn',
      'test6.pgn',
      'test7.pgn',
      'test8.pgn',
      'test9.pgn',
    ]) {
      const res = await upload(real(name));
      expect(res.status).toBe(202);
    }

    const tournaments = await tournamentsFor(playerId);
    const keys = tournaments.map((t) => t.key).sort();
    // test4,7,8,9 are Biel Chess Festival (Jul 14-17); test5 is Fagernes (no
    // site); test6 is New Jersey Open 1957.
    expect(keys).toEqual([
      'biel chess festival 2025 mto',
      'fagernes international autumn 2025',
      'new jersey open',
    ]);

    const games = await gameTournaments(playerId);
    expect(games).toHaveLength(6);

    // Every game is attached, to exactly three tournaments.
    for (const g of games) expect(g.tournament_id).not.toBeNull();
    const distinct = new Set(games.map((g) => g.tournament_id));
    expect(distinct.size).toBe(3);
  });
});

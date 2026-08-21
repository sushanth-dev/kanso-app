import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { game, player, tournament } from '../db/schema.ts';
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

async function list(userId: string | null, query = '') {
  return app(userId).request(`/games${query}`);
}

async function makePlayer(ownerId: string): Promise<string> {
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: ownerId, displayName: 'Test Player' })
    .returning({ id: player.id });
  return row!.id;
}

/** Insert a tournament row and return its id. */
async function seedTournament(
  playerId: string,
  fields: Partial<typeof tournament.$inferInsert> = {},
): Promise<string> {
  const [t] = await harness.db
    .insert(tournament)
    .values({ playerId, name: 'Autumn Open', key: 'autumn open', ...fields })
    .returning({ id: tournament.id });
  return t!.id;
}

let seq = 0;
async function insertGame(
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
      ...fields,
    })
    .returning({ id: game.id });
  return row!.id;
}

interface GameListBody {
  games: { id: string; stream: string; playedAt: string | null }[];
  total: number;
  page: number;
  limit: number;
}

describe('GET /games', () => {
  test('filters by stream and never returns another player’s games', async () => {
    const mine = await makePlayer(OWNER);
    const theirs = await makePlayer(OTHER);
    const t1 = await insertGame(mine, { stream: 'tournament' });
    const o1 = await insertGame(mine, { stream: 'online' });
    const foreign = await insertGame(theirs, { stream: 'tournament' });

    const tournament = (await (await list(OWNER, '?stream=tournament')).json()) as GameListBody;
    expect(tournament.games.map((g) => g.id)).toEqual([t1]);

    const online = (await (await list(OWNER, '?stream=online')).json()) as GameListBody;
    expect(online.games.map((g) => g.id)).toEqual([o1]);

    const both = (await (await list(OWNER)).json()) as GameListBody;
    expect(both.games.map((g) => g.id).sort()).toEqual([t1, o1].sort());
    expect(both.games.map((g) => g.id)).not.toContain(foreign);
  });

  test('orders newest first, with games that have no played_at last', async () => {
    const mine = await makePlayer(OWNER);
    const older = await insertGame(mine, { playedAt: new Date('2024-01-01T00:00:00Z') });
    const newer = await insertGame(mine, { playedAt: new Date('2025-01-01T00:00:00Z') });
    const undated = await insertGame(mine, { playedAt: null });

    const body = (await (await list(OWNER)).json()) as GameListBody;
    expect(body.games.map((g) => g.id)).toEqual([newer, older, undated]);
  });

  test('pages with the contract defaults, reporting the unpaged total', async () => {
    const mine = await makePlayer(OWNER);
    for (let i = 0; i < 3; i++) {
      await insertGame(mine, { playedAt: new Date(`2025-01-0${i + 1}T00:00:00Z`) });
    }

    const firstPage = (await (await list(OWNER, '?limit=2&page=1')).json()) as GameListBody;
    expect(firstPage.games).toHaveLength(2);
    expect(firstPage.total).toBe(3);
    expect(firstPage.page).toBe(1);
    expect(firstPage.limit).toBe(2);

    const secondPage = (await (await list(OWNER, '?limit=2&page=2')).json()) as GameListBody;
    expect(secondPage.games).toHaveLength(1);
    expect(secondPage.total).toBe(3);

    const defaults = (await (await list(OWNER)).json()) as GameListBody;
    expect(defaults.limit).toBe(50);
    expect(defaults.page).toBe(1);
  });

  test('rejects a limit outside the permitted range rather than clamping it', async () => {
    expect((await list(OWNER, '?limit=10000000')).status).toBe(400);
    expect((await list(OWNER, '?limit=0')).status).toBe(400);
    expect((await list(OWNER, '?page=0')).status).toBe(400);
  });

  test('gives a player with no games an empty page, not a 404', async () => {
    await makePlayer(OWNER);
    const res = await list(OWNER);
    expect(res.status).toBe(200);
    const body = (await res.json()) as GameListBody;
    expect(body.games).toEqual([]);
    expect(body.total).toBe(0);
  });

  test('answers 401 with no session', async () => {
    expect((await list(null)).status).toBe(401);
  });

  test('scopes to one tournament and composes with the stream filter', async () => {
    const mine = await makePlayer(OWNER);
    const t1 = await seedTournament(mine);
    const t2 = await seedTournament(mine);
    const inT1 = await insertGame(mine, { tournamentId: t1, stream: 'tournament' });
    const inT2 = await insertGame(mine, { tournamentId: t2, stream: 'tournament' });
    const unattached = await insertGame(mine, { stream: 'tournament' });

    const scopedT1 = (await (await list(OWNER, `?tournament=${t1}`)).json()) as GameListBody;
    expect(scopedT1.games.map((g) => g.id)).toEqual([inT1]);

    const scopedT2 = (await (await list(OWNER, `?tournament=${t2}`)).json()) as GameListBody;
    expect(scopedT2.games.map((g) => g.id)).toEqual([inT2]);

    // An unattached game appears in the unfiltered list and in neither scoped one.
    const both = (await (await list(OWNER)).json()) as GameListBody;
    expect(both.games.map((g) => g.id).sort()).toEqual([inT1, inT2, unattached].sort());

    // The tournament filter composes with the stream filter rather than
    // replacing it: scoping to t1 with only tournament games returns t1's.
    const scopedStream = (await (
      await list(OWNER, `?stream=tournament&tournament=${t1}`)
    ).json()) as GameListBody;
    expect(scopedStream.games.map((g) => g.id)).toEqual([inT1]);
  });

  test('answers 403 for a tournament the caller has no claim on', async () => {
    await makePlayer(OWNER);
    const theirs = await makePlayer(OTHER);
    const foreign = await seedTournament(theirs);
    await insertGame(theirs, { tournamentId: foreign });
    // A real tournament owned by another player: the 403 proves the claim check,
    // which a made-up id would not.
    const res = await list(OWNER, `?tournament=${foreign}`);
    expect(res.status).toBe(403);
  });

  test('answers 403 for a tournament that does not exist, not 404', async () => {
    await makePlayer(OWNER);
    // Absence and refusal look identical from outside, so the id cannot be used
    // to enumerate which tournaments exist.
    const res = await list(OWNER, '?tournament=00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(403);
  });
});

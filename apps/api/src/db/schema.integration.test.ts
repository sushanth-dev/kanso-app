/**
 * Proves the harness works by asserting a constraint only a real database
 * enforces. `game_pgn_unique` stops a re-uploaded PGN duplicating a game; a
 * mocked database would accept the second insert and every test would pass.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { user } from './auth-schema.ts';
import { game, player } from './schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from './test-harness.ts';

describe('game_pgn_unique', () => {
  let harness: IntegrationDatabase;

  beforeAll(async () => {
    harness = await setupIntegrationDatabase();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.close();
  });

  async function insertPlayer(): Promise<string> {
    const [u] = await harness.db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: 'Test User',
        email: `${crypto.randomUUID()}@test.invalid`,
      })
      .returning({ id: user.id });
    if (!u) throw new Error('user insert returned no row');
    const [p] = await harness.db
      .insert(player)
      .values({ ownerUserId: u.id, displayName: 'Test Player' })
      .returning({ id: player.id });
    if (!p) throw new Error('player insert returned no row');
    return p.id;
  }

  function aGame(playerId: string, pgnHash: string) {
    return {
      playerId,
      stream: 'tournament' as const,
      source: 'pgn_upload' as const,
      pgnHash,
      pgn: '[Event "Test"]\n\n1. e4 e5 1-0',
      playerColor: 'white' as const,
      result: '1-0' as const,
    };
  }

  test('rejects the same (player_id, pgn_hash) twice', async () => {
    const playerId = await insertPlayer();
    await harness.db.insert(game).values(aGame(playerId, 'hash-1'));

    // Drizzle wraps the driver error in a `DrizzleQueryError` whose `message`
    // is the failed SQL, not the constraint name; the original `PostgresError`
    // — whose message names `game_pgn_unique` — is on `.cause`. Read the cause
    // so a mock that accepted the duplicate would actually fail here.
    const error = await harness.db
      .insert(game)
      .values(aGame(playerId, 'hash-1'))
      .then(
        () => {
          throw new Error('duplicate (player_id, pgn_hash) insert was accepted');
        },
        (e: unknown) => e as { cause?: { message?: string } },
      );
    expect(error.cause?.message ?? '').toMatch(/game_pgn_unique/);
  });

  test('accepts the same pgn_hash for a different player', async () => {
    const first = await insertPlayer();
    const second = await insertPlayer();
    await harness.db.insert(game).values(aGame(first, 'hash-1'));

    await harness.db.insert(game).values(aGame(second, 'hash-1'));
  });

  test('reset gives each test an empty database', async () => {
    // This test inserts nothing. If reset works, no player rows exist whatever
    // order the tests ran in.
    const rows = await harness.db.select().from(player);
    expect(rows).toEqual([]);
  });
});

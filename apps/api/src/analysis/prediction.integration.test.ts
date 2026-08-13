/**
 * The sprint-1 prediction, tested end to end: analysis feeds the opening-leak
 * report, and the report ranks the opening the player actually plays worse.
 *
 * ST-004 built the aggregation against hand-written mistake rows, which proves
 * the arithmetic and nothing about the input. This file puts real games through
 * the real engine, lets `analyseGame` write whatever rows it writes, and asks
 * the untouched query what it makes of them. If the two halves disagree about
 * what a mistake is, or about whose mistake it is, this is where it shows.
 *
 * Nothing in `openings/` is modified to make this pass, and no exact leak score
 * is asserted: the score is the engine's opinion at a depth this file chose, and
 * pinning it would be pinning Stockfish rather than us. The ranking and the
 * arithmetic are ours, so those are asserted.
 *
 * Depth 12 again, for the same reason as `analyse-game.integration.test.ts`, and
 * because four games at production depth is a two-minute test nobody runs.
 */
import { createRequire } from 'node:module';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { user } from '../db/auth-schema.ts';
import { game, mistake, player } from '../db/schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import { MIN_GAMES, openingLeaks } from '../openings/opening-leaks.ts';
import { analyseGame } from './analyse-game.ts';
import type { EngineOptions } from './engine.ts';

const enginePath = createRequire(import.meta.url).resolve('stockfish/bin/stockfish-18-single.js');

const options: EngineOptions = {
  enginePath,
  depth: 12,
  nodeCeiling: 2_000_000,
  engines: 4,
  hashMb: 16,
};

interface Fixture {
  eco: string;
  opening: string;
  playerColor: 'white' | 'black';
  pgn: string;
}

/**
 * Two openings, two games each, so both clear `MIN_GAMES`.
 *
 * The Philidor pair are the two best-known miniatures in the opening, and the
 * player is Black in both: Black is the side that loses a piece for nothing in
 * one and gets mated in thirteen plies in the other. The Giuoco Pianissimo pair
 * are the same quiet symmetrical development in two move orders, where neither
 * side does anything the engine can object to.
 *
 * So the prediction has a real answer here rather than an arranged one: these
 * are not positions doctored to produce mistakes, they are games where one
 * opening went badly and the other did not.
 */
const FIXTURES: Fixture[] = [
  {
    eco: 'C41',
    opening: 'Philidor Defense',
    playerColor: 'black',
    // Morphy vs Duke of Brunswick and Count Isouard, Paris 1858.
    pgn:
      '1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 ' +
      '8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 ' +
      '14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0',
  },
  {
    eco: 'C41',
    opening: 'Philidor Defense',
    playerColor: 'black',
    // Légal vs Saint Brie, Paris 1750: the mate the opening is named for.
    pgn: '1. e4 e5 2. Bc4 d6 3. Nf3 Nc6 4. Nc3 Bg4 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5# 1-0',
  },
  {
    eco: 'C50',
    opening: 'Italian Game: Giuoco Pianissimo',
    playerColor: 'white',
    pgn:
      '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d6 6. O-O O-O 7. Re1 a6 ' +
      '8. Bb3 Ba7 9. h3 h6 10. Nbd2 Re8 1/2-1/2',
  },
  {
    eco: 'C50',
    opening: 'Italian Game: Giuoco Pianissimo',
    playerColor: 'white',
    pgn:
      '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 Nf6 5. c3 d6 6. O-O O-O 7. Bb3 a6 ' +
      '8. Re1 Ba7 9. Nbd2 Re8 10. h3 h6 1/2-1/2',
  },
  {
    // One game, and the threshold is two: this opening is what `withheld`
    // counts. A player who has played something once has not shown a leak in
    // it, and the report says so rather than staying silent.
    eco: 'C42',
    opening: 'Petrov Defense',
    playerColor: 'black',
    pgn: '1. e4 e5 2. Nf3 Nf6 3. Nxe5 Nxe4 4. Qe2 Nf6 5. Nc6+ 1-0',
  },
];

let harness: IntegrationDatabase;
let playerId: string;

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
  await harness.db.insert(user).values({
    id: 'user_owner',
    name: 'Owner',
    email: 'owner@example.com',
    emailVerified: true,
  });
  const [seeded] = await harness.db
    .insert(player)
    .values({ ownerUserId: 'user_owner', displayName: 'Test Player' })
    .returning({ id: player.id });
  playerId = seeded!.id;
});

async function seedAndAnalyse(): Promise<string[]> {
  const ids: string[] = [];
  for (const fixture of FIXTURES) {
    const [row] = await harness.db
      .insert(game)
      .values({
        playerId,
        stream: 'tournament',
        source: 'pgn_upload',
        pgnHash: `hash-${crypto.randomUUID()}`,
        pgn: fixture.pgn,
        playerColor: fixture.playerColor,
        eco: fixture.eco,
        opening: fixture.opening,
        result: '1-0',
      })
      .returning({ id: game.id });
    await analyseGame(harness.db, row!.id, options);
    ids.push(row!.id);
  }
  return ids;
}

/** What the rows actually say, counted independently of the query under test. */
async function mistakesByEco(gameIds: string[]): Promise<Map<string, number>> {
  const rows = await harness.db
    .select({ eco: game.eco })
    .from(mistake)
    .innerJoin(game, eq(mistake.gameId, game.id))
    .where(inArray(game.id, gameIds));
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.eco as string, (counts.get(row.eco as string) ?? 0) + 1);
  return counts;
}

describe('the opening report over engine-analysed games', () => {
  test('ranks the opening the player actually played worse first', async () => {
    const ids = await seedAndAnalyse();

    const result = await openingLeaks(harness.db, playerId, 'tournament');

    // Both openings with two games are reported; the one played once is not.
    expect(result.leaks.map((l) => l.eco)).toEqual(['C41', 'C50']);
    expect(result.withheld).toBe(1);

    const [worst, rest] = result.leaks;
    expect(worst!.leakScore).toBeGreaterThan(rest!.leakScore);
    expect(worst!.openingName).toBe('Philidor Defense');

    // The arithmetic, against the rows rather than against a number written
    // here: `leakScore` is mistakes over games, and both counts are the ones
    // analysis wrote.
    const counted = await mistakesByEco(ids);
    for (const leak of result.leaks) {
      expect(leak.games).toBe(MIN_GAMES);
      expect(leak.mistakes).toBe(counted.get(leak.eco) ?? 0);
      expect(leak.leakScore).toBeCloseTo(leak.mistakes / leak.games);
    }
  }, 120_000);

  test('counts the player’s mistakes and not the opponent’s', async () => {
    // The query has no filter on colour, so every mistake row on a counted
    // game lands in that opening's score. That is only correct while analysis
    // writes the player's moves alone, which is what this asserts from the
    // report's side: Black's disasters in the Philidor are the player's, and
    // White's winning moves in the same games are nobody's mistakes.
    const ids = await seedAndAnalyse();

    const rows = await harness.db
      .select({ movingColor: mistake.movingColor, playerColor: game.playerColor })
      .from(mistake)
      .innerJoin(game, eq(mistake.gameId, game.id))
      .where(inArray(game.id, ids));

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.movingColor).toBe(row.playerColor);
  }, 120_000);
});

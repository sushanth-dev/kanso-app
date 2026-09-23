/**
 * `analyseGame` against a real PostgreSQL and a real engine.
 *
 * Nothing here is stubbed: the evaluations come out of Stockfish and the rows
 * go into a real database, because the two failures this file exists to catch
 * are a bad row shape and a bad transaction, and neither survives a stand-in.
 *
 * Depth 12 rather than the production 21. The depth changes which moves the
 * engine calls mistakes; it does not change whether the rows are written once,
 * attributed to the right colour, or replaced on a second run, which is what is
 * asserted below.
 */
import { createRequire } from 'node:module';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { user } from '../db/auth-schema.ts';
import { evaluationCache, game, mistake, movePly, player } from '../db/schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
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

/** Black hangs the queen on ply 6. Chosen because the blunder is not arguable. */
const BLUNDER_PGN = '1. e4 e5 2. Nf3 Qf6 3. Nc3 Qxf3 4. gxf3 1-0';

/**
 * Black's ply 2 is the only legal move in the position, so that ply has no
 * evaluation of its own: it takes the value of the position Black's move
 * reaches, which is White's ply 3. ST-171.
 */
const FORCED_PGN = [
  '[SetUp "1"]',
  '[FEN "7k/8/5K1P/8/8/8/8/8 w - - 0 1"]',
  '',
  '1. Kg6 Kg8 2. h7+ Kf8 3. h8=Q+ 1-0',
].join('\n');

/**
 * White's 1. Qb8+ hangs the queen, and Black has exactly one reply, Kxb8.
 *
 * This is the case the report has to name. The move that decides the game
 * leaves the opponent a forced reply, so the position after Qb8+ has no
 * evaluation of its own. Before ST-171 that position borrowed the evaluation
 * of the position before it, which made `evalBefore` and `evalAfter` of ply 1
 * equal, the drop zero, and the worst move of the game invisible.
 */
const FORCED_BLUNDER_PGN = [
  '[SetUp "1"]',
  '[FEN "k7/pp6/3Q4/8/8/8/8/7K w - - 0 1"]',
  '[Result "0-1"]',
  '',
  '1. Qb8+ Kxb8 0-1',
].join('\n');

let harness: IntegrationDatabase;

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
});

async function seedGame(pgn: string, playerColor: 'white' | 'black' | null): Promise<string> {
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
  const [row] = await harness.db
    .insert(game)
    .values({
      playerId: seeded!.id,
      stream: 'tournament',
      source: 'pgn_upload',
      pgnHash: `hash-${crypto.randomUUID()}`,
      pgn,
      playerColor,
      result: '1-0',
    })
    .returning({ id: game.id });
  return row!.id;
}

const plies = (gameId: string) =>
  harness.db.select().from(movePly).where(eq(movePly.gameId, gameId)).orderBy(asc(movePly.ply));

const mistakes = (gameId: string) =>
  harness.db.select().from(mistake).where(eq(mistake.gameId, gameId)).orderBy(asc(mistake.ply));

describe('analyseGame', () => {
  test('writes a row per ply, the player’s mistakes, and the cost it took', async () => {
    const gameId = await seedGame(BLUNDER_PGN, 'black');

    const outcome = await analyseGame(harness.db, gameId, options);

    expect(outcome.status).toBe('complete');
    expect(outcome.plies).toBe(7);
    expect(outcome.mistakes).toBeGreaterThan(0);

    const [row] = await harness.db.select().from(game).where(eq(game.id, gameId));
    expect(row!.analysisStatus).toBe('complete');
    expect(row!.analyzedAt).not.toBeNull();
    expect(row!.analysisError).toBeNull();
    // B3: cost per analysed game is an objective with no number behind it yet.
    // These columns are what turn it from an estimate into a measurement.
    expect(row!.analysisNodes).toBeGreaterThan(0);
    expect(row!.analysisDurationMs).toBeGreaterThan(0);
    // ST-045: the cost is the duration converted at the deployed rate, so O4
    // is a query over this column, not a re-measurement.
    expect(row!.analysisCostMicros).toBeGreaterThan(0);
    expect(outcome.costMicros).toBe(row!.analysisCostMicros);

    const plyRows = await plies(gameId);
    expect(plyRows).toHaveLength(7);
    expect(plyRows.map((p) => p.san)).toEqual(['e4', 'e5', 'Nf3', 'Qf6', 'Nc3', 'Qxf3', 'gxf3']);
    for (const ply of plyRows) {
      expect(ply.evalCp === null && ply.evalMate === null).toBe(false);
      expect(ply.bestMoveSan).not.toBeNull();
    }
  });

  test('reads %clk into move_ply and attributes a phase to every ply', async () => {
    // White's clock after e4 is 2:58, after Nf3 is 2:57; black's after e5 is
    // 2:59. The first move of each side has no previous clock, so its
    // move_time_ms is null; white's second move took one second.
    const CLOCKED_PGN =
      '[Event "Live Chess"]\n[Result "1-0"]\n\n1. e4 {[%clk 0:02:58]} e5 {[%clk 0:02:59]} 2. Nf3 {[%clk 0:02:57]} 1-0';
    const gameId = await seedGame(CLOCKED_PGN, 'white');

    await analyseGame(harness.db, gameId, options);

    const rows = await plies(gameId);
    expect(rows).toHaveLength(3);
    expect(rows.map((p) => p.clockMs)).toEqual([178000, 179000, 177000]);
    expect(rows.map((p) => p.moveTimeMs)).toEqual([null, null, 1000]);
    expect(rows.map((p) => p.phase)).toEqual(['opening', 'opening', 'opening']);
  });

  test('a game with two consecutive comments after one move analyses', async () => {
    // ST-035: chess.js rejects `{ ... } { ... }` after one move. The merged
    // game must analyse, not just parse.
    const TWO_COMMENTS_PGN =
      '[Event "Live Chess"]\n[Result "1-0"]\n\n1. e4 { 0.12/0 } { [%cal Ge2e4] } e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O 1-0';
    const gameId = await seedGame(TWO_COMMENTS_PGN, 'white');

    const outcome = await analyseGame(harness.db, gameId, options);

    expect(outcome.status).toBe('complete');
    expect(outcome.plies).toBe(9);
    const [row] = await harness.db.select().from(game).where(eq(game.id, gameId));
    expect(row!.analysisStatus).toBe('complete');
    expect(row!.analysisError).toBeNull();
  });

  test('records mistakes for the player’s own moves and nobody else’s', async () => {
    // The opening-leak aggregation counts every mistake row on a game with no
    // filter on colour, so an opponent's blunder stored here would be read as
    // the player's. This is the assertion that stops that coming back.
    const gameId = await seedGame(BLUNDER_PGN, 'black');

    await analyseGame(harness.db, gameId, options);

    const rows = await mistakes(gameId);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.movingColor).toBe('black');
    // The hung queen is on ply 6 and no depth-12 engine calls it acceptable.
    expect(rows.map((r) => r.ply)).toContain(6);
  });

  test('analysing twice replaces the rows rather than adding to them', async () => {
    const gameId = await seedGame(BLUNDER_PGN, 'black');

    await analyseGame(harness.db, gameId, options);
    const firstPlies = await plies(gameId);
    const firstMistakes = await mistakes(gameId);

    await analyseGame(harness.db, gameId, options);
    const secondPlies = await plies(gameId);
    const secondMistakes = await mistakes(gameId);

    expect(secondPlies).toHaveLength(firstPlies.length);
    expect(secondMistakes.map((r) => [r.ply, r.judgement])).toEqual(
      firstMistakes.map((r) => [r.ply, r.judgement]),
    );
  });

  test('a game that cannot be analysed ends failed, with nothing half-written', async () => {
    const gameId = await seedGame('this is not a game', 'white');

    await expect(analyseGame(harness.db, gameId, options)).rejects.toThrow();

    const [row] = await harness.db.select().from(game).where(eq(game.id, gameId));
    expect(row!.analysisStatus).toBe('failed');
    expect(row!.analysisError).toBeTruthy();
    // A stack trace in a column people read is our internals on their screen.
    expect(row!.analysisError).not.toContain('at ');
    // The reason names the offending token, not just "analysis failed".
    expect(row!.analysisError).toContain('"a"');
    expect(await plies(gameId)).toHaveLength(0);
    expect(await mistakes(gameId)).toHaveLength(0);
  });

  test('a forced move takes the value of the position after it', async () => {
    const gameId = await seedGame(FORCED_PGN, 'black');

    await analyseGame(harness.db, gameId, options);

    const rows = await plies(gameId);
    const forced = rows[1];
    expect(forced!.san).toBe('Kg8');
    // The forced position has no value of its own: it holds the value of the
    // position the only legal move reaches, which is the next ply's before.
    expect(forced!.evalCp).toBe(rows[2]!.evalCp);
    expect(forced!.evalMate).toBe(rows[2]!.evalMate);
    // The only legal move is also the best one there was.
    expect(forced!.bestMoveSan).toBe('Kg8');
    // A player who had one move to make did not make a mistake. The other
    // black ply in this game, Kf8, does allow h8=Q+ where Kh8 would block the
    // pawn, and it is a mistake row on its own merits.
    expect((await mistakes(gameId)).map((row) => row.ply)).not.toContain(2);
  });

  test('names the blunder that forces the opponent to a single reply', async () => {
    // k7/pp6/3Q4/8/8/8/8/7K w, 1. Qb8+ Kxb8. White hangs the queen and Black's
    // only legal reply takes it. Before ST-171 the position after Qb8+ borrowed
    // the evaluation of the position before it, so the drop read as zero and the
    // worst move of the game produced no row at all.
    const gameId = await seedGame(FORCED_BLUNDER_PGN, 'white');

    await analyseGame(harness.db, gameId, options);

    const rows = await plies(gameId);
    expect(rows.map((row) => row.san)).toEqual(['Qb8+', 'Kxb8']);

    const found = await mistakes(gameId);
    expect(found).toHaveLength(1);
    const blunder = found[0]!;
    expect(blunder.ply).toBe(1);
    expect(blunder.moveSan).toBe('Qb8+');
    expect(blunder.judgement).toBe('blunder');
    // White was winning and is now lost: the queen is gone and Black is up.
    expect(blunder.evalAfterMate).toBeNull();
    expect(blunder.evalAfterCp!).toBeLessThan(-300);
    expect(blunder.winProbDrop).toBeGreaterThan(0.5);
    // The engine preferred something other than hanging the queen.
    expect(blunder.bestMoveSan).not.toBe('Qb8+');
  });

  test('caches evaluations and re-searches swings at the deeper depth', async () => {
    const gameId = await seedGame(BLUNDER_PGN, 'black');

    await analyseGame(harness.db, gameId, options);

    const cached = await harness.db.select().from(evaluationCache);
    const depths = new Set(cached.map((r) => r.depth));
    // The first pass wrote depth-12 entries; the hung-queen swing wrote
    // depth-15 entries on the deep pass. Both prove the two passes ran.
    expect(depths).toContain(12);
    expect(depths).toContain(15);

    // A second analysis of the same game searches nothing new: every
    // non-forced position is now cached at both depths.
    const [first] = await harness.db.select().from(game).where(eq(game.id, gameId));
    await analyseGame(harness.db, gameId, options);
    const [second] = await harness.db.select().from(game).where(eq(game.id, gameId));
    expect(second!.analysisNodes!).toBeLessThan(first!.analysisNodes!);
  });

  test('refuses a game with no player colour instead of analysing nobody', async () => {
    const gameId = await seedGame(BLUNDER_PGN, null);

    await expect(analyseGame(harness.db, gameId, options)).rejects.toThrow(/player colour/);

    const [row] = await harness.db
      .select()
      .from(game)
      .where(and(eq(game.id, gameId), eq(game.analysisStatus, 'failed')));
    expect(row).toBeDefined();
  });
});

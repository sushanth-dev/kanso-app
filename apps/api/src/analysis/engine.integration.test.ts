/**
 * The engine driver against a real Stockfish.
 *
 * Named `*.integration.test.ts` so it runs in the integration project and never
 * in the pre-commit hook. It needs no database, but an engine test in a hook
 * that runs on every commit is a hook people switch off.
 *
 * The engine is the WebAssembly build from the `stockfish` package. Production
 * runs a native binary compiled from the same release, and ADR-0023 records the
 * measurement that makes running two builds acceptable: at a fixed depth the
 * two search identically, to the node.
 *
 * Depth 12 rather than the production 21, because the point here is the driver,
 * not the search, and a suite measured in minutes is a suite nobody runs.
 */
import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';
import { evaluatePositions, type EngineOptions } from './engine.ts';

const enginePath = createRequire(import.meta.url).resolve('stockfish/bin/stockfish-18-single.js');

const options: EngineOptions = {
  enginePath,
  depth: 12,
  nodeCeiling: 2_000_000,
  engines: 4,
  hashMb: 16,
};

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const WHITE_A_QUEEN_UP = '4k3/pppppppp/8/8/8/8/PPPPPPPP/3QK3 w - - 0 1';
const BLACK_A_QUEEN_UP = '3qk3/pppppppp/8/8/8/8/PPPPPPPP/4K3 b - - 0 1';
const MATE_IN_ONE = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';

describe('evaluatePositions', () => {
  test('evaluates the starting position as roughly equal, with a move to play', async () => {
    const [result] = await evaluatePositions([START], { ...options, engines: 1 });

    expect(result.fen).toBe(START);
    expect(result.score.mate).toBeUndefined();
    expect(Math.abs(result.score.cp ?? 0)).toBeLessThan(150);
    expect(result.bestMoveUci).toMatch(/^[a-h][1-8][a-h][1-8]/);
    expect(result.depth).toBeGreaterThanOrEqual(options.depth);
    expect(result.nodes).toBeGreaterThan(0);
  });

  test('scores are white-absolute, so the same material reads opposite from each side', async () => {
    const [white, black] = await evaluatePositions([WHITE_A_QUEEN_UP, BLACK_A_QUEEN_UP], options);

    // A queen up for White is a large positive number; the mirrored position,
    // with Black to move and Black a queen up, is a large negative one. The
    // engine reports both from the side to move, so this pair is what proves
    // the normalisation rather than an accidental double negative.
    expect(white.score.cp ?? 0).toBeGreaterThan(500);
    expect(black.score.cp ?? 0).toBeLessThan(-500);
  });

  test('reports a mate score rather than centipawns when there is a mate', async () => {
    const [result] = await evaluatePositions([MATE_IN_ONE], { ...options, engines: 1 });

    expect(result.score.mate).toBe(1);
    expect(result.score.cp).toBeUndefined();
    expect(result.bestMoveUci).toBe('a1a8');
  });

  test('returns results in input order however they are dealt across engines', async () => {
    // Sixteen positions across four engines. Round-robin dealing is exactly
    // what returns them shuffled if the results are collected in completion
    // order instead of by index.
    const fens = Array.from({ length: 16 }, (_, i) =>
      i % 2 === 0 ? WHITE_A_QUEEN_UP : BLACK_A_QUEEN_UP,
    );

    const results = await evaluatePositions(fens, { ...options, depth: 8 });

    expect(results).toHaveLength(16);
    expect(results.map((r) => r.fen)).toEqual(fens);
    for (const [i, result] of results.entries()) {
      if (i % 2 === 0) expect(result.score.cp ?? 0).toBeGreaterThan(500);
      else expect(result.score.cp ?? 0).toBeLessThan(-500);
    }
  });

  test('refuses a position that could carry a second command into the conversation', async () => {
    // The engine is spoken to over a pipe, so a newline in a FEN would append a
    // UCI command rather than a position. FENs come from chess.js today; this
    // is the boundary refusing to depend on that.
    await expect(
      evaluatePositions([`${START}\ngo infinite`], { ...options, engines: 1 }),
    ).rejects.toThrow(/plain FEN/);
  });

  test('evaluates nothing without starting an engine', async () => {
    await expect(evaluatePositions([], options)).resolves.toEqual([]);
  });
});

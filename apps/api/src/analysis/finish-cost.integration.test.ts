/**
 * ST-158. The measured cost of the finish-your-own-game fallback search.
 *
 * This is the evidence for the story's acceptance criterion that the endpoint
 * cost is measured and stated. It runs the real WASM engine at FINISH_DEPTH on
 * one middlegame position and asserts the wall time stays under the budget the
 * interactive endpoint can afford, printing the number for the story
 * resolution. Named `*.integration.test.ts` so it never runs in the pre-commit
 * hook, like the rest of the engine suite.
 */
import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';
import { evaluatePositions, type EngineOptions } from './engine.ts';
import { FINISH_DEPTH } from './budget.ts';

const enginePath = createRequire(import.meta.url).resolve('stockfish/bin/stockfish-18-single.js');

// One engine on the API function, 32 MB hash, matching defaultEngineOptions
// in games/engine-reply.ts.
const options: EngineOptions = {
  enginePath,
  depth: FINISH_DEPTH,
  nodeCeiling: 15_000_000,
  engines: 1,
  hashMb: 32,
};

const MIDDLEGAME = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';

describe('the finish search cost', () => {
  test('depth 14 on a middlegame position answers in interactive time', async () => {
    const start = performance.now();
    const [result] = await evaluatePositions([MIDDLEGAME], options);
    const elapsedMs = performance.now() - start;

    console.log(
      `ST-158 cost: depth ${result!.depth}, ${result!.nodes.toLocaleString()} nodes, ` +
        `${elapsedMs.toFixed(0)} ms wall`,
    );
    expect(result!.depth).toBeGreaterThanOrEqual(FINISH_DEPTH);
    // One engine process start plus a depth-14 search; the interactive bar
    // this endpoint has to clear is about a second of the client's patience.
    expect(elapsedMs).toBeLessThan(5_000);
  });
});

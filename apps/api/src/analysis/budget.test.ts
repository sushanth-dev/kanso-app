/**
 * ADR-0023. The budget, pinned as named values.
 *
 * Every constant here is a decision a story or an ADR made, and DEBT-001's
 * golden tests are tuned against them. Pinning the numbers means moving one of
 * them fails a unit test, which is the point: a silent retune of the analysis
 * contract is the drift ADR-0022 warns about.
 */
import { describe, expect, test } from 'vitest';
import {
  ANALYSIS_DEPTH,
  ANALYSIS_ENGINES,
  ANALYSIS_ENGINE_VERSION,
  ANALYSIS_HASH_MB,
  ANALYSIS_NODE_CEILING,
  DEEP_PASS_EXTRA_DEPTH,
  SWING_WIN_PROB_EPSILON,
} from './budget.ts';

describe('the analysis budget', () => {
  test('the depth is the contract, 21', () => {
    expect(ANALYSIS_DEPTH).toBe(21);
  });

  test('the node ceiling sits just above the worst measured position', () => {
    // ADR-0023 measured 12,167,980 nodes on the worst position; the ceiling
    // must stay above it and below a number that times a Lambda out.
    expect(ANALYSIS_NODE_CEILING).toBe(15_000_000);
    expect(ANALYSIS_NODE_CEILING).toBeGreaterThan(12_167_980);
  });

  test('two engines match the account’s Lambda memory quota', () => {
    // 3008 MB caps at about one and a half vCPUs, so two single-threaded
    // engines is the ceiling this account can deploy.
    expect(ANALYSIS_ENGINES).toBe(2);
  });

  test('the transposition table is sized per engine process', () => {
    expect(ANALYSIS_HASH_MB).toBe(128);
  });

  test('the engine version is the cache key’s version and names a release', () => {
    // Must move with STOCKFISH_RELEASE in Dockerfile.analysis; two values that
    // disagree would serve one version's evaluation under another's key.
    expect(ANALYSIS_ENGINE_VERSION).toBe('sf_18');
  });

  test('the deep pass reaches depth 24, still under the node ceiling', () => {
    expect(DEEP_PASS_EXTRA_DEPTH).toBe(3);
    expect(ANALYSIS_DEPTH + DEEP_PASS_EXTRA_DEPTH).toBe(24);
  });

  test('the swing epsilon is the classifier’s inaccuracy threshold', () => {
    // ST-047: exactly the plies the classifier would call an inaccuracy or
    // worse are the plies worth a deeper look.
    expect(SWING_WIN_PROB_EPSILON).toBe(0.085);
  });
});

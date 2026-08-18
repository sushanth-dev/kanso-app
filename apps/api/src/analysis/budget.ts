/**
 * ADR-0023. The analysis budget, as named values rather than literals.
 *
 * The story requires a bounded budget that can be changed without hunting for a
 * number, and DEBT-001's golden tests are tuned against whatever these say, so
 * moving one of them is a deliberate change to the code and the tests together.
 *
 * Depth is the contract: it is what decides whether an evaluation can be
 * trusted. The node ceiling is the safety rail, sized just above the worst
 * position measured while writing ADR-0023 (12,167,980 nodes against a mean of
 * 1,669,489), so a pathological position stops rather than running until the
 * function times out.
 */
export const ANALYSIS_DEPTH = 21;
export const ANALYSIS_NODE_CEILING = 15_000_000;

/**
 * One engine process per vCPU. The account's Lambda memory quota caps at
 * 3008 MB (about one and a half vCPUs), so two engines fit the deployed
 * function. ADR-0023 measured four engines 3.3x faster than one at no cost
 * in depth, and revisits four when the quota is raised; two is the ceiling
 * this account can deploy today.
 */
export const ANALYSIS_ENGINES = 2;

/** Transposition table per engine process, not per invocation. */
export const ANALYSIS_HASH_MB = 128;

/**
 * The engine release the evaluations were produced by. This is the cache key's
 * version, and it must move with the `STOCKFISH_RELEASE` arg in
 * `Dockerfile.analysis`: two values that disagree would serve one version's
 * evaluation under another's key, which is the cache lying the way ADR-0022
 * says a gate lies.
 */
export const ANALYSIS_ENGINE_VERSION = 'sf_18';

/**
 * ST-047. The two-pass scan re-searches a swinging ply at
 * `ANALYSIS_DEPTH + DEEP_PASS_EXTRA_DEPTH`. Three plies past the depth-21
 * contract reaches depth 24, still under the 15,000,000-node ceiling for the
 * mean position.
 */
export const DEEP_PASS_EXTRA_DEPTH = 3;

/**
 * A ply swings when the mover's win probability drops by more than this, on
 * the `winProbDrop` [0, 1] scale. 0.085 is the classifier's inaccuracy
 * threshold, so exactly the plies worth a deeper look are re-searched.
 */
export const SWING_WIN_PROB_EPSILON = 0.085;

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
 * One engine process per vCPU at 7,077 MB of Lambda memory. Measured 3.3x
 * faster than a single engine on the same game, at no cost in depth, where
 * giving one engine four threads reached depth 14.4 instead of 18.1 for the
 * same work.
 */
export const ANALYSIS_ENGINES = 4;

/** Transposition table per engine process, not per invocation. */
export const ANALYSIS_HASH_MB = 128;

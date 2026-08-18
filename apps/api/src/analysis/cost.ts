/**
 * O4, ST-045. The compute cost of one analysis, in micro-dollars, from the
 * worker's own duration and memory at the arm64 rate in ap-south-2 that
 * `analysis-cost.md` records. Written to `game.analysis_cost_micros` on every
 * analysed game, so the weekly number is a query over that column rather than
 * a re-measurement by hand.
 *
 * The rate and the memory default are the numbers `analysis-cost.md` measured
 * against (3,008 MB, $0.0000133334 per GB-second). `memoryMb` is read from
 * Lambda's own `AWS_LAMBDA_FUNCTION_MEMORY_SIZE` at the call site, so a change
 * to the deployed function shape corrects the cost without touching this file;
 * the default keeps local runs and the integration suite honest.
 */
export const GB_SECOND_USD = 0.0000133334;
export const DEFAULT_MEMORY_MB = 3008;

export function costMicrosFor(durationMs: number, memoryMb: number = DEFAULT_MEMORY_MB): number {
  return Math.round((durationMs / 1000) * (memoryMb / 1024) * GB_SECOND_USD * 1_000_000);
}

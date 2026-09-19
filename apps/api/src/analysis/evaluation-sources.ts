/**
 * ST-171. Which position each position's evaluation comes from.
 *
 * A position with exactly one legal move has no alternative to compare against,
 * so its value is the value of the position that move reaches: the number flows
 * forward through a forced move, not backward from the position before it. A run
 * of forced positions therefore takes the value at the end of the run. The last
 * position in the walk has no successor, so it is always searched.
 *
 * Kept pure, like `two-pass.ts`, so the rule unit-tests without an engine, a
 * database, or a FEN.
 */

/**
 * `sources[i] === i` means position `i` is searched. `sources[i] > i` means it
 * takes the evaluation of position `sources[i]`, which is itself searched. No
 * entry is ever an earlier index, and every source is its own source, so a
 * lookup through this array always lands on a position that was searched.
 */
export function evaluationSources(legalMoveCounts: number[]): number[] {
  const last = legalMoveCounts.length - 1;
  const sources = new Array<number>(legalMoveCounts.length);
  for (let i = last; i >= 0; i--) {
    const inherits = legalMoveCounts[i] === 1 && i < last;
    sources[i] = inherits ? sources[i + 1]! : i;
  }
  return sources;
}

/**
 * ST-171. Which position each evaluation comes from, pure.
 *
 * The rule is small and the mistakes it prevents are expensive, so these tests
 * pin every case that matters: a forced move forwards, a run of forced moves,
 * the last position, and the invariants the assembly loop relies on. No engine,
 * no database, no FEN.
 */
import { describe, expect, test } from 'vitest';
import { evaluationSources } from './evaluation-sources.ts';

/** Every entry is its own source, or a later one that is. */
function sourcesAreSettled(sources: number[]): boolean {
  return sources.every((source, index) => source >= index && sources[source] === source);
}

describe('evaluationSources', () => {
  test('a position with a choice is its own source', () => {
    expect(evaluationSources([28, 12, 5])).toEqual([0, 1, 2]);
  });

  test('a forced position takes the value of the position after it', () => {
    // Index 1 is forced, so the number flows forward to index 2.
    expect(evaluationSources([28, 1, 5])).toEqual([0, 2, 2]);
  });

  test('a run of forced positions takes the value at the end of the run', () => {
    expect(evaluationSources([28, 1, 1, 1, 5])).toEqual([0, 4, 4, 4, 4]);
  });

  test('the last position is always searched, even when it is forced', () => {
    // A forced last position has no successor to take a value from.
    expect(evaluationSources([28, 1])).toEqual([0, 1]);
  });

  test('a position with no legal moves is searched', () => {
    // Checkmate or stalemate: the terminal value belongs to this position.
    expect(evaluationSources([28, 0, 3])).toEqual([0, 1, 2]);
  });

  test('a walk of one position is searched', () => {
    expect(evaluationSources([28])).toEqual([0]);
    expect(evaluationSources([1])).toEqual([0]);
  });

  test('an empty walk returns nothing', () => {
    expect(evaluationSources([])).toEqual([]);
  });

  test('the counterexample: a forced reply after a blunder', () => {
    // k7/pp6/3Q4/8/8/8/8/7K w, 1. Qb8+ Kxb8. White has 28 moves, the position
    // after Qb8+ is forced for Black, and position 2 is where the blunder shows.
    const sources = evaluationSources([28, 1, 3]);
    expect(sources).toEqual([0, 2, 2]);
    expect(sourcesAreSettled(sources)).toBe(true);
  });

  test('every source is settled for any walk', () => {
    expect(sourcesAreSettled(evaluationSources([1, 1, 1]))).toBe(true);
    expect(sourcesAreSettled(evaluationSources([0, 1, 0, 1, 1, 2]))).toBe(true);
    expect(sourcesAreSettled(evaluationSources([28, 1, 1, 12, 1, 1, 1, 0]))).toBe(true);
  });
});

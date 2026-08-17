/**
 * ST-035. `mergeAdjacentComments`, over the exact shapes the story reproduced.
 *
 * No database, no engine: chess.js's two-consecutive-comment rejection and the
 * merge that fixes it, pinned so the clock survives the repair.
 */
import { Chess } from 'chess.js';
import { describe, expect, test } from 'vitest';
import { mergeAdjacentComments } from './analyse-game.ts';
import { parseClockMs } from './clock.ts';

/** `{ ... } { ... }` after one move is the shape that fails raw and loads merged. */
const TWO_COMMENTS = '1. e4 { 0.12/0 } { [%cal Ge2e4] } e5 1-0';
/** A clock comment and an eval comment on the same move: `%clk` must survive. */
const CLOCK_PLUS_EVAL = '1. e4 { [%clk 0:03:00] } { [%eval 0.2] } e5 1-0';

describe('mergeAdjacentComments', () => {
  test('the reproduced case throws raw and loads merged', () => {
    expect(() => new Chess().loadPgn(TWO_COMMENTS)).toThrow();
    expect(() => new Chess().loadPgn(mergeAdjacentComments(TWO_COMMENTS))).not.toThrow();
  });

  test('a single comment is left untouched', () => {
    const single = '1. e4 { 0.12/0 } e5 1-0';
    expect(mergeAdjacentComments(single)).toBe(single);
  });

  test('a clock comment beside an eval comment still yields %clk after the merge', () => {
    expect(() => new Chess().loadPgn(CLOCK_PLUS_EVAL)).toThrow();
    const chess = new Chess();
    chess.loadPgn(mergeAdjacentComments(CLOCK_PLUS_EVAL));
    const clockMs = chess
      .getComments()
      .map((c) => parseClockMs(c.comment))
      .filter((ms) => ms !== null);
    expect(clockMs).toEqual([180000]);
  });

  test('a game malformed for another reason still fails after the merge', () => {
    const illegal = '1. e4 Xx9';
    expect(mergeAdjacentComments(illegal)).toBe(illegal);
    expect(() => new Chess().loadPgn(mergeAdjacentComments(illegal))).toThrow();
  });
});

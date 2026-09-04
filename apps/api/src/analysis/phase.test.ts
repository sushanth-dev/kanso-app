/**
 * ST-025. The phase rule, pinned so a boundary constant cannot drift unnoticed.
 *
 * No database, no clock, no engine: these are the positions a coach will ask
 * about, answered with the constants they map to.
 */
import { describe, expect, test } from 'vitest';
import { ENDGAME_MAX_NONPAWN_MATERIAL, OPENING_MAX_PLY, phaseFor } from './phase.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** Queenless, white rook and bishop (8 points) versus a bare king: an endgame. */
const ENDGAME = '4k3/8/8/8/8/8/1R6/5B1K w - - 0 40';
/** White queen alone on the board: queens keep it out of the endgame. */
const WITH_QUEENS = '4k3/8/8/8/8/8/8/Q3K3 w - - 0 40';
/** White rook + rook + bishop (13 points), queenless: the exact endgame cap. */
const AT_CAP = '4k3/8/8/8/8/8/8/R1B1K2R w - - 0 40';
/** White rook + bishop + bishop + knight (14 points), queenless: just past the cap. */
const OVER_CAP = '4k3/8/8/8/8/8/8/RBBNK3 w - - 0 40';

describe('phaseFor', () => {
  test('ply 20 and under from the start position is the opening', () => {
    expect(phaseFor(START, 1)).toBe('opening');
    expect(phaseFor(START, 20)).toBe('opening');
  });

  test('ply 21 and over from the start position is the middlegame', () => {
    expect(phaseFor(START, 21)).toBe('middlegame');
    expect(phaseFor(START, 40)).toBe('middlegame');
  });

  test('a queenless low-material position is the endgame, whatever the ply', () => {
    expect(phaseFor(ENDGAME, 40)).toBe('endgame');
    expect(phaseFor(ENDGAME, 8)).toBe('endgame');
  });

  test('queens on the board keep the position out of the endgame', () => {
    expect(phaseFor(WITH_QUEENS, 40)).toBe('middlegame');
  });

  test('the material cap is inclusive: 13 is the endgame, 14 is not', () => {
    expect(phaseFor(AT_CAP, 40)).toBe('endgame');
    expect(phaseFor(OVER_CAP, 40)).toBe('middlegame');
  });

  test('the boundary constants are the numbers the story decided', () => {
    expect(OPENING_MAX_PLY).toBe(20);
    expect(ENDGAME_MAX_NONPAWN_MATERIAL).toBe(13);
  });

  test('black pieces count the same as white pieces', () => {
    // The board field is case-insensitive: black's lowercase rook (5 points)
    // with no queens is an endgame; black's lowercase queen keeps it out.
    expect(phaseFor('4k3/8/8/8/8/8/1r6/6K1 b - - 0 40', 40)).toBe('endgame');
    expect(phaseFor('2q5/8/8/8/8/8/1r6/6K1 b - - 0 40', 40)).toBe('middlegame');
  });

  test('a board with no pieces at all is the endgame', () => {
    // An empty board field has no queens and no material; the function is
    // total, so it must still answer with a phase.
    expect(phaseFor('8/8/8/8/8/8/8/8 w - - 0 1', 1)).toBe('endgame');
  });
});

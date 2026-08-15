/**
 * ST-024. The motif set and its attribution rule, pinned per motif.
 *
 * Every position below is one the primitives already classify, so this file
 * pins the mapping from those primitives to the closed set rather than
 * re-proving the chess physics they rest on.
 */
import { describe, expect, test } from 'vitest';
import { MOTIFS, attributeMotif } from './motif.ts';

describe('attributeMotif', () => {
  test('the set is closed and named', () => {
    expect(MOTIFS).toEqual(['hanging_piece', 'missed_check', 'missed_capture', 'missed_threat']);
  });

  test('a move that hangs a piece is a hanging_piece', () => {
    // White queen takes the d4 pawn but walks onto a square the black knight
    // c6 and rook d8 both control with only the queen herself backing it.
    const fen = '3rk3/8/2n5/8/3p4/8/8/3QK3 w - - 0 1';
    expect(attributeMotif(fen, 'Qxd4', 'Qd2')).toBe('hanging_piece');
  });

  test('hanging_piece wins over a missed tactic when both apply', () => {
    // Same blunder, but the engine wanted the check Qe2+: the hung piece is
    // still the headline, not the missed check.
    const fen = '3rk3/8/2n5/8/3p4/8/8/3QK3 w - - 0 1';
    expect(attributeMotif(fen, 'Qxd4', 'Qe2+')).toBe('hanging_piece');
  });

  test('the engine wanting a check the player missed is a missed_check', () => {
    const fen = '4k3/8/8/4p3/3P4/Q7/8/4K3 w - - 0 1';
    expect(attributeMotif(fen, 'Kd2', 'Qa4+')).toBe('missed_check');
  });

  test('the engine wanting a capture the player missed is a missed_capture', () => {
    const fen = '4k3/8/8/4p3/3P4/Q7/8/4K3 w - - 0 1';
    expect(attributeMotif(fen, 'Kd2', 'dxe5')).toBe('missed_capture');
  });

  test('the engine wanting a mate threat the player missed is a missed_threat', () => {
    const fen = '6k1/5ppp/5B2/7Q/8/8/5PPP/6K1 w - - 0 1';
    expect(attributeMotif(fen, 'Kh1', 'Qh6')).toBe('missed_threat');
  });

  test('a quiet move with no tactic and no hung piece is unattributed', () => {
    const fen = '4k3/8/8/4p3/3P4/Q7/8/4K3 w - - 0 1';
    expect(attributeMotif(fen, 'Ke2', 'Kd2')).toBeNull();
  });
});

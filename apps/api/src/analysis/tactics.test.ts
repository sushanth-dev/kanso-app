/**
 * Unit tests for tactical motif detection.
 */
import { describe, expect, test } from 'vitest';
import { detectTacticalMotif } from './tactics.ts';

describe('detectTacticalMotif', () => {
  test('knight fork: attacking king and rook', () => {
    // White knight on d5 jumps to c7, checking king on e8 and attacking rook on a8
    const forkFen = 'r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1';
    expect(detectTacticalMotif(forkFen, 'Nc7+')).toBe('fork');
  });

  test('pawn fork: pawn attacks two minor pieces', () => {
    // White pawn on d4 moves to d5, attacking knight on c6 and bishop on e6
    const fen = '4k3/8/2n1b3/8/3P4/8/8/4K3 w - - 0 1';
    expect(detectTacticalMotif(fen, 'd5')).toBe('fork');
  });

  test('absolute pin: bishop pins knight to king', () => {
    // White bishop moves to b5; Black pawn on d6 leaves the c6-e8 diagonal open,
    // so Nc6 is pinned directly to Ke8.
    const fen = 'r1bqkb1r/ppp2ppp/2np4/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 4';
    expect(detectTacticalMotif(fen, 'Bb5')).toBe('pin');
  });

  test('relative pin: bishop pins knight to queen', () => {
    // White bishop moves to g5, pinning Nf6 to Qd8
    const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/3P1N2/PPP2PPP/RNBQKB1R w KQkq - 0 4';
    expect(detectTacticalMotif(fen, 'Bg5')).toBe('pin');
  });

  test('skewer: rook checks king, king moves exposing queen behind it', () => {
    // King in front on e6, Queen behind on e8, Rook moves to e1+
    const skewerFen = '4q3/8/4k3/8/8/8/8/R5K1 w - - 0 1';
    expect(detectTacticalMotif(skewerFen, 'Re1+')).toBe('skewer');
  });

  test('discovered attack: moving knight unmasks bishop attacking queen', () => {
    // White: Bg2, Nd5. Black: Qa8, Ke8.
    // Knight on d5 moves to b6, unmasking Bg2's diagonal attack on Qa8.
    const fen = 'q3k3/8/8/3N4/8/8/6B1/4K3 w - - 0 1';
    expect(detectTacticalMotif(fen, 'Nb6')).toBe('discovered_attack');
  });

  test('back-rank mate: rook delivers mate on rank 8 with pawns blocking king', () => {
    // Black king on g8 with pawns on f7, g7, h7. White rook moves to d8#
    const mateSetupFen = '6k1/5ppp/8/8/8/8/8/3R2K1 w - - 0 1';
    expect(detectTacticalMotif(mateSetupFen, 'Rd8#')).toBe('back_rank_mate');
  });
  test('discovered check: unmasking check while mover attacks rook is discovered attack, not fork', () => {
    const fen = '3k4/r7/8/8/3N4/8/8/3Q2K1 w - - 0 1';
    expect(detectTacticalMotif(fen, 'Nb5+')).toBe('discovered_attack');
  });

  test('trapped piece: pawn move traps enemy rook with zero legal moves', () => {
    const fen = '6br/7p/6P1/7k/8/8/8/7K w - - 0 1';
    expect(detectTacticalMotif(fen, 'g7')).toBe('trapped_piece');
  });

  test('quiet move has no tactical motif', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    expect(detectTacticalMotif(fen, 'e5')).toBeNull();
  });
});

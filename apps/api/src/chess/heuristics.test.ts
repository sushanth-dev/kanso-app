/**
 * Characterisation coverage for the carried-over heuristic models.
 *
 * The three scoring models (`calculateTension`, `calculateKingSafety`,
 * `calculateActivity`) and the two aggregators came over from the prototype
 * untested. This file pins what they compute today, before any change, so a
 * retune is a deliberate change to covered code rather than a silent drift.
 *
 * The models are "physically isolated", meaning the scores are raw and not
 * normalised to a common scale. The tests record the raw numbers as they are,
 * not an opinion about what they should be.
 */
import { Chess } from 'chess.js';
import { describe, expect, test } from 'vitest';
import {
  calculateActivity,
  calculateGameSignature,
  calculateKingSafety,
  calculateTension,
  analyzeFullGame,
} from './heuristics.ts';

describe('calculateTension', () => {
  test('is zero on the quiet starting position', () => {
    expect(calculateTension(new Chess())).toBe(0);
  });

  test('rises when a piece is attacked by an enemy piece', () => {
    // White queen e5 is attacked down the file by the black rook e8.
    const chess = new Chess('4r1k1/8/8/4Q3/8/8/8/4K3 w - - 0 1');
    expect(calculateTension(chess)).toBe(48);
  });
  test('caps at 100 no matter how much material is en prise', () => {
    // Seven black queens each attacked by (and attacking) a white rook: far
    // past the 500 raw points the /5 needs to saturate.
    const chess = new Chess('qqqqkqqq/8/8/8/8/8/8/RRRRKRRR w - - 0 1');
    expect(calculateTension(chess)).toBe(100);
  });

  test('counts contested squares that hold no attacked piece', () => {
    // The knights' attack sets overlap on d5 and e4; nothing is attacked.
    const chess = new Chess('4k3/8/5n2/8/8/2N5/8/4K3 w - - 0 1');
    expect(calculateTension(chess)).toBe(8); // 2 contested squares x 20 / 5
  });

  test('an attacked king carries no material value but its zone still counts', () => {
    // Re7 attacks the black king (worth 0), is itself attacked by that king
    // (+50), and the kings' overlapping attacks make d7 and f7 contested
    // (+40): (50 + 40) / 5 = 18.
    const chess = new Chess('4k3/4R3/8/8/8/8/8/4K3 w - - 0 1');
    expect(calculateTension(chess)).toBe(18);
  });
});

describe('calculateKingSafety', () => {
  test('is 100 with no enemy attack on the king zone', () => {
    expect(calculateKingSafety(new Chess('4k3/8/8/8/8/8/8/4K3 w - - 0 1'), 'w')).toBe(100);
  });

  test('falls when the enemy queen attacks the king zone', () => {
    // Black queen e8 attacks white king e1 down the file; no defender.
    const chess = new Chess('4q1k1/8/8/8/8/8/8/4K3 w - - 0 1');
    expect(calculateKingSafety(chess, 'w')).toBe(40);
  });

  test('reads the attack from the requested colour, not always from White', () => {
    // Mirror of the queen attack above with colours swapped.
    const chess = new Chess('4k3/8/8/8/8/8/8/4Q1K1 b - - 0 1');
    expect(calculateKingSafety(chess, 'b')).toBe(40);
  });

  test('clamps to 0 when the raw penalty exceeds the scale', () => {
    // Two black queens each attack the white king's 3x3 zone: 120 raw penalty
    // with no defenders would score -20, which clamps to 0.
    const chess = new Chess('7k/8/8/8/8/6q1/5q2/7K w - - 0 1');
    expect(calculateKingSafety(chess, 'w')).toBe(0);
  });

  test('mitigation caps at 60% with four or more defenders', () => {
    // Qd2 and Re2 occupy the zone; Bh3 and Ng3 attack into it (f1). Four
    // defenders give exactly 60%: 100 - (60 * 0.4) = 76.
    const four = new Chess('3qk3/8/8/8/8/6NB/3Q1R2/4K3 w - - 0 1');
    expect(calculateKingSafety(four, 'w')).toBe(76);
    // A fifth defender (Rh1 also attacks f1) adds nothing: still capped.
    const five = new Chess('3qk3/8/8/8/8/6NB/3Q1R2/4K2R w - - 0 1');
    expect(calculateKingSafety(five, 'w')).toBe(76);
  });
});

describe('calculateActivity', () => {
  test('counts a queen on the centre square at the 5x weight', () => {
    // White queen d4 attacks the four centre-adjacent squares (weight 5 each)
    // plus edge squares, divided by two.
    const chess = new Chess('4k3/8/8/8/3Q4/8/8/4K3 w - - 0 1');
    expect(calculateActivity(chess, 'w')).toBe(25);
  });

  test('adds coordination points for a defended friendly piece', () => {
    // The bishop c3 defends the queen d4, adding +10 coordination on top of the
    // queen's own attacked squares.
    const chess = new Chess('4k3/8/8/8/3Q4/2B5/8/4K3 w - - 0 1');
    expect(calculateActivity(chess, 'w')).toBe(43);
  });

  test('weights centre, extended-centre, and outer squares 5 / 2 / 1', () => {
    // Rook f4 attacks d4 and e4 (centre, 10), c4/f3/f5/f6 (extended, 8) and
    // eight outer squares (8); the king on a1 adds a2/b1/b2 (3). 29 / 2 = 15.
    const chess = new Chess('4k3/8/8/8/5R2/8/8/K7 w - - 0 1');
    expect(calculateActivity(chess, 'w')).toBe(15);
  });

  test('caps at 100 when the attack map is enormous', () => {
    const chess = new Chess('4k3/8/8/8/8/8/QQQQQQQQ/QQQ2QQK w - - 0 1');
    expect(calculateActivity(chess, 'w')).toBe(100);
  });
});

describe('calculateGameSignature', () => {
  test('averages the sampled positions across a game', () => {
    const pgn = `[White "A"]
[Black "B"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7`;
    expect(calculateGameSignature(pgn)).toEqual({ tension: 40, safety: 96, activity: 93 });
  });

  test('returns zeroes for a game with no moves', () => {
    expect(calculateGameSignature('')).toEqual({ tension: 0, safety: 0, activity: 0 });
  });

  test('samples a single-move game once, on the mover-opponent turn', () => {
    // After 1. e4 the sampled turn is Black: nothing is attacked (tension 0
    // comes only from the contested a6, opened by the e-pawn), the black king
    // is safe, and Black's activity matches the starting position's 83.
    expect(calculateGameSignature('1. e4')).toEqual({ tension: 4, safety: 100, activity: 83 });
  });

  test('samples both positions of a two-move game', () => {
    expect(calculateGameSignature('1. e4 e5')).toEqual({ tension: 6, safety: 100, activity: 84 });
  });
});

describe('analyzeFullGame', () => {
  const fens = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 1 1',
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 2 2',
  ];

  test('samples only the positions where it is the user turn', () => {
    // The second fen is black's turn, so it is skipped for a white user.
    const result = analyzeFullGame(fens, 'white');
    expect(result.map((m) => m.moveNumber)).toEqual([1, 2]);
    expect(result[0]).toEqual({ moveNumber: 1, tension: 0, safety: 100, activity: 83 });
  });

  test('samples only black-turn positions for a black user', () => {
    const result = analyzeFullGame(fens, 'black');
    expect(result.map((m) => m.moveNumber)).toEqual([1]);
    expect(result[0]).toEqual({ moveNumber: 1, tension: 4, safety: 100, activity: 83 });
  });

  test('derives the move number when the fen omits the fullmove counter', () => {
    // A four-field fen leaves parseInt undefined; the fallback derives the
    // move number from the position index: ceil((i + 1) / 2).
    const bare = [
      '4k3/8/8/8/8/8/8/4K3 w - -',
      '4k3/8/8/8/8/8/8/4K3 b - -',
      '4k3/8/8/8/8/8/8/4K3 w - -',
    ];
    expect(analyzeFullGame(bare, 'white').map((m) => m.moveNumber)).toEqual([1, 2]);
  });
});
describe('calculateKingSafety: king zone geometry', () => {
  test('clips the 3x3 zone at the board edge instead of scoring phantom squares', () => {
    // A king in the corner has a four-square zone (a1, a2, b1, b2). The black
    // queen a8 attacks a1 and a2 down the file: 60 raw penalty, no defenders
    // → 40. A phantom ninth square beyond the edge would not change this, but
    // the clipping is what keeps b-file attackers from counting twice.
    const chess = new Chess('6qk/8/8/8/8/8/8/K7 w - - 0 1');
    expect(calculateKingSafety(chess, 'w')).toBe(40);
  });

  test('counts a pawn shield as defenders, matching the documented example', () => {
    // The doc comment's worked example: a queen attacks the king zone and two
    // pawns occupy it, for a 30% mitigation: 100 - (60 * 0.70) = 58.
    const chess = new Chess('3qk3/8/8/8/8/8/4PPP1/4K3 w - - 0 1');
    expect(calculateKingSafety(chess, 'w')).toBe(58);
  });
});

describe('calculateActivity: perspective and baselines', () => {
  test('scores the black position from black pieces, not always White', () => {
    // Mirror of the white-queen-d4 test with colours flipped: the black queen
    // attacks the same geometry, so the score matches White's 25.
    const chess = new Chess('4k3/8/8/8/3q4/8/8/4K3 b - - 0 1');
    expect(calculateActivity(chess, 'b')).toBe(25);
  });

  test('a lone corner king still scores its three adjacent squares', () => {
    // The king attacks a2, b1, b2 — three outer squares worth 1 each, so
    // 3 / 2 rounds to 2. Pins that the divisor is applied after rounding
    // would otherwise hide.
    const chess = new Chess('4k3/8/8/8/8/8/8/K7 w - - 0 1');
    expect(calculateActivity(chess, 'w')).toBe(2);
  });
});

describe('analyzeFullGame', () => {
  test('returns an empty list for an empty game rather than throwing', () => {
    expect(analyzeFullGame([], 'white')).toEqual([]);
  });
});

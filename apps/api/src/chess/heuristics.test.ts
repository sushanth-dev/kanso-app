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

  test('each defender in the king zone mitigates 15% of the penalty', () => {
    // Same queen attack, but the white rook e2 sits in the king zone, so one
    // defender applies 15% mitigation: 100 - (60 * 0.85) = 49.
    const chess = new Chess('4q1k1/8/8/8/8/8/4R3/4K3 w - - 0 1');
    expect(calculateKingSafety(chess, 'w')).toBe(49);
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
});

describe('calculateGameSignature', () => {
  test('averages the sampled positions across a game', () => {
    const pgn = `[White "A"]
[Black "B"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7`;
    expect(calculateGameSignature(pgn)).toEqual({ tension: 40, safety: 96, activity: 93 });
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
});

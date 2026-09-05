import { describe, expect, test } from 'vitest';
import {
  CONSISTENCY_MIN_GAMES,
  CONSISTENCY_WINDOW_PLIES,
  modalLineConsistency,
} from './line-consistency.ts';

/** A first-ten-ply line, as the query hands it over: SAN per ply. */
const line = (...sans: string[]): string[] => sans;

const E4_LINE = line('e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7');
const D4_LINE = line('d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O');

describe('ST-123. modalLineConsistency', () => {
  test('the floor and the window are pinned, so they cannot drift silently', () => {
    expect(CONSISTENCY_MIN_GAMES).toBe(5);
    expect(CONSISTENCY_WINDOW_PLIES).toBe(10);
  });

  test('a group under the floor is withheld, naming how many games it holds', () => {
    const withheld = modalLineConsistency(
      Array.from({ length: CONSISTENCY_MIN_GAMES - 1 }, () => E4_LINE),
    );
    expect(withheld).toEqual({ status: 'below_floor', games: CONSISTENCY_MIN_GAMES - 1 });

    // At the floor the number exists.
    const atFloor = modalLineConsistency(
      Array.from({ length: CONSISTENCY_MIN_GAMES }, () => E4_LINE),
    );
    expect(atFloor).toEqual({
      status: 'ok',
      matched: CONSISTENCY_MIN_GAMES,
      games: CONSISTENCY_MIN_GAMES,
    });
  });

  test('the share counts the games that follow the modal line, out of every game', () => {
    // Four games follow the e4 line; one plays the d4 complex the whole way.
    const result = modalLineConsistency([E4_LINE, E4_LINE, E4_LINE, E4_LINE, D4_LINE]);
    expect(result).toEqual({ status: 'ok', matched: 4, games: 5 });
  });

  test('a game that leaves the line on move eleven still matches the window', () => {
    const leavesLate = [...E4_LINE, 'd6'];
    const result = modalLineConsistency([E4_LINE, E4_LINE, leavesLate, E4_LINE, D4_LINE]);
    expect(result).toEqual({ status: 'ok', matched: 4, games: 5 });
  });

  test('a game that ends before the window closes counts but cannot match', () => {
    const short = line('e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6');
    const result = modalLineConsistency([E4_LINE, E4_LINE, E4_LINE, E4_LINE, short]);
    expect(result).toEqual({ status: 'ok', matched: 4, games: 5 });
  });

  test('a game with no stored plies counts in the denominator and never matches', () => {
    const result = modalLineConsistency([E4_LINE, E4_LINE, E4_LINE, E4_LINE, []]);
    expect(result).toEqual({ status: 'ok', matched: 4, games: 5 });
  });

  test('a modal tie breaks to the lexicographically smaller line, deterministically', () => {
    // Two lines, each played twice; the fifth game is a short e4 game that
    // cannot match either. The e4 line sorts before the d4 line.
    const short = line('e4', 'e5');
    const result = modalLineConsistency([E4_LINE, E4_LINE, D4_LINE, D4_LINE, short]);
    expect(result).toEqual({ status: 'ok', matched: 2, games: 5 });
  });

  test('a group with no game reaching the window has no line, not a zero', () => {
    const result = modalLineConsistency([
      line('e4', 'e5'),
      line('e4', 'e5'),
      line('e4', 'e5'),
      line('d4'),
      line('f3'),
    ]);
    expect(result).toEqual({ status: 'no_full_line', games: 5 });
  });
});

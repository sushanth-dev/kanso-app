/**
 * ST-032. The four computations' pure scorers, with no database.
 *
 * The SQL halves of these are covered by the integration tests; these pin the
 * arithmetic and the refusal floors. The tactical test uses a single hanging
 * pawn: white to move can capture it (found) or step away (missed).
 */
import { describe, expect, test } from 'vitest';
import {
  MIN_WON_POSITIONS,
  openingScore,
  playerScore,
  playerWon,
  reachedWonPosition,
  tacticFoundRate,
  wonPositionConversion,
} from './computations.ts';

describe('converting won positions', () => {
  test('playerWon reads the stored colour and result', () => {
    expect(playerWon('white', '1-0')).toBe(true);
    expect(playerWon('black', '0-1')).toBe(true);
    expect(playerWon('white', '0-1')).toBe(false);
    expect(playerWon('black', '1-0')).toBe(false);
    expect(playerWon('white', '1/2-1/2')).toBe(false);
  });

  test('reachedWonPosition is +2.0 from the player perspective', () => {
    expect(reachedWonPosition('white', [{ cp: 200 }])).toBe(true);
    expect(reachedWonPosition('white', [{ cp: 100 }])).toBe(false);
    expect(reachedWonPosition('black', [{ cp: -200 }])).toBe(true);
    expect(reachedWonPosition('black', [{ cp: -100 }])).toBe(false);
  });

  test('wonPositionConversion is converted over reached', () => {
    const games = [
      { wonPosition: true, won: true },
      { wonPosition: true, won: false },
      { wonPosition: true, won: true },
    ];
    expect(wonPositionConversion(games)).toBeCloseTo(2 / 3);
  });

  test('wonPositionConversion refuses below the floor', () => {
    const games = Array.from({ length: MIN_WON_POSITIONS - 1 }, () => ({
      wonPosition: true,
      won: true,
    }));
    expect(wonPositionConversion(games)).toBeNull();
  });
});

describe('opening repertoire results', () => {
  test('playerScore is win 1, draw 0.5, loss 0, undecided null', () => {
    expect(playerScore('white', '1-0')).toBe(1);
    expect(playerScore('white', '1/2-1/2')).toBe(0.5);
    expect(playerScore('white', '0-1')).toBe(0);
    expect(playerScore('white', '*')).toBeNull();
  });

  test('openingScore averages the games', () => {
    expect(openingScore([1, 0.5, 0])).toBeCloseTo(0.5);
  });

  test('openingScore refuses below three games', () => {
    expect(openingScore([1, 1])).toBeNull();
  });
});

describe('tactical alertness', () => {
  // Black pawn on b2 hangs; white king on b1 can capture it (b1b2) or step
  // aside (b1c1), which creates no new threat and is therefore not a tactic.
  const FEN = 'k7/8/8/8/8/8/1p6/1K6 w - - 0 1';

  test('counts a played capture as found', () => {
    const positions = Array.from({ length: 10 }, () => ({
      fenBefore: FEN,
      playedUci: 'b1b2',
      bestMoveSan: 'Kxb2',
    }));
    expect(tacticFoundRate(positions)).toBeCloseTo(1);
  });

  test('counts a quiet move that ignores the tactic as missed', () => {
    const positions = Array.from({ length: 10 }, () => ({
      fenBefore: FEN,
      playedUci: 'b1c1',
      bestMoveSan: 'Kxb2',
    }));
    expect(tacticFoundRate(positions)).toBeCloseTo(0);
  });

  test('refuses below ten offered positions', () => {
    const positions = Array.from({ length: 9 }, () => ({
      fenBefore: FEN,
      playedUci: 'b1b2',
      bestMoveSan: 'Kxb2',
    }));
    expect(tacticFoundRate(positions)).toBeNull();
  });
});

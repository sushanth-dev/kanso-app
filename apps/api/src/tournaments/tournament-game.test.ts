import { describe, expect, test } from 'vitest';
import { resultPoints, toTournamentGame } from './tournament-game.ts';
import type { game } from '../db/schema.ts';

/** Build a game row with just the fields the projection reads. */
function row(fields: Partial<typeof game.$inferSelect>): typeof game.$inferSelect {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    playerColor: null,
    result: '1-0',
    round: null,
    board: null,
    whiteName: 'White Player',
    blackName: 'Black Player',
    analysisStatus: 'pending',
    ...fields,
  } as typeof game.$inferSelect;
}

describe('toTournamentGame', () => {
  test('names the opponent from the side the player is not on', () => {
    expect(
      toTournamentGame(row({ playerColor: 'white', whiteName: 'A', blackName: 'B' })).opponent,
    ).toBe('B');
    expect(
      toTournamentGame(row({ playerColor: 'black', whiteName: 'A', blackName: 'B' })).opponent,
    ).toBe('A');
  });

  test('leaves the opponent null when the side is undecided', () => {
    expect(toTournamentGame(row({ playerColor: null })).opponent).toBeNull();
  });

  test('gives the result from the player’s point of view', () => {
    // White player, white won.
    expect(toTournamentGame(row({ playerColor: 'white', result: '1-0' })).result).toBe('win');
    // Black player, white won.
    expect(toTournamentGame(row({ playerColor: 'black', result: '1-0' })).result).toBe('loss');
    // Black player, black won.
    expect(toTournamentGame(row({ playerColor: 'black', result: '0-1' })).result).toBe('win');
    expect(toTournamentGame(row({ playerColor: 'white', result: '1/2-1/2' })).result).toBe('draw');
  });

  test('leaves the result null for an undecided side or an unknown result', () => {
    expect(toTournamentGame(row({ playerColor: null, result: '1-0' })).result).toBeNull();
    expect(toTournamentGame(row({ playerColor: 'white', result: '*' })).result).toBeNull();
  });

  test('marks a game analysed only when its analysis is complete', () => {
    expect(toTournamentGame(row({ analysisStatus: 'complete' })).analysed).toBe(true);
    expect(toTournamentGame(row({ analysisStatus: 'pending' })).analysed).toBe(false);
  });
});

describe('resultPoints', () => {
  test('scores a win, a draw and a loss', () => {
    expect(resultPoints('win')).toBe(1);
    expect(resultPoints('draw')).toBe(0.5);
    expect(resultPoints('loss')).toBe(0);
  });
});

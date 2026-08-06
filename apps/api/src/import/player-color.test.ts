import { describe, expect, test } from 'vitest';
import { decidePlayerColor } from './player-color.ts';

describe('decidePlayerColor', () => {
  test('matches the player to White', () => {
    expect(
      decidePlayerColor('Test Player', 'Player, Test', 'Carlsen, Magnus'),
    ).toBe('white');
  });

  test('matches the player to Black', () => {
    expect(
      decidePlayerColor('Test Player', 'Carlsen, Magnus', 'Player, Test'),
    ).toBe('black');
  });

  test('returns null when neither side matches', () => {
    expect(
      decidePlayerColor('Test Player', 'Carlsen, Magnus', 'Nakamura, Hikaru'),
    ).toBeNull();
  });

  test('returns null when both sides match, rather than guessing', () => {
    expect(decidePlayerColor('Test Player', 'Player, Test', 'Test Player')).toBeNull();
  });

  test('returns null when a name tag is absent', () => {
    expect(decidePlayerColor('Test Player', null, 'Player, Test')).toBe('black');
    expect(decidePlayerColor('Test Player', null, null)).toBeNull();
  });
});

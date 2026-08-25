import { describe, expect, test } from 'vitest';
import { decidePlayerColor } from './player-color.ts';

describe('decidePlayerColor', () => {
  test('matches the player to White', () => {
    expect(
      decidePlayerColor('Sushanth Kamabathula', 'Kamabathula, Sushanth', 'Carlsen, Magnus'),
    ).toBe('white');
  });

  test('matches the player to Black', () => {
    expect(
      decidePlayerColor('Sushanth Kamabathula', 'Carlsen, Magnus', 'Kamabathula, Sushanth'),
    ).toBe('black');
  });

  test('returns null when neither side matches', () => {
    expect(
      decidePlayerColor('Sushanth Kamabathula', 'Carlsen, Magnus', 'Nakamura, Hikaru'),
    ).toBeNull();
  });

  test('returns null when both sides match, rather than guessing', () => {
    expect(decidePlayerColor('Test Player', 'Player, Test', 'Test Player')).toBeNull();
  });

  test('returns null when a name tag is absent', () => {
    expect(decidePlayerColor('Sushanth Kamabathula', null, 'Kamabathula, Sushanth')).toBe('black');
    expect(decidePlayerColor('Sushanth Kamabathula', null, null)).toBeNull();
  });

  test('matches an abbreviated crosstable name to a side', () => {
    expect(decidePlayerColor('Sushanth Kamabathula', 'Carlsen, Magnus', 'Kamabathula, S.')).toBe(
      'black',
    );
  });

  test('returns null when an initial makes both sides match', () => {
    expect(
      decidePlayerColor('S. Kamabathula', 'Kamabathula, Sushanth', 'Kamabathula, S.'),
    ).toBeNull();
  });

  test('matches a player who typed only their given name to a full PGN name', () => {
    expect(decidePlayerColor('Sushanth', 'Sushanth Kamabathula', 'Poeck, Ole')).toBe('white');
  });

  test('does not match a bare given name to a namesake with a different surname', () => {
    expect(decidePlayerColor('Sushanth', 'Sushanth Kamabathula', 'Sushanth Patel')).toBeNull();
  });
});

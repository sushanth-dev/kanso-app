/**
 * Which side of the board the player was on, decided from a PGN tag.
 *
 * Eighteen lines that we hit on day one of importing tournament games, because
 * crosstables write "Player, Test" and a player types "Test
 * Player". Getting it wrong reports the opponent's mistakes as the
 * player's own, which is worse than reporting nothing.
 */
import { describe, expect, test } from 'vitest';
import { isNameMatch, normalizeName } from './pgn-name-match.ts';

const matches = (user: string, pgn: string) => isNameMatch(normalizeName(user), normalizeName(pgn));

describe('normalizeName', () => {
  test('lowercases and splits on whitespace', () => {
    expect(normalizeName('Test Player')).toEqual(new Set(['test', 'player']));
  });

  test('drops punctuation, so a comma-reversed crosstable name tokenizes the same', () => {
    expect(normalizeName('Player, Test')).toEqual(new Set(['player', 'test']));
  });

  test('drops the period from an initial rather than keeping it in the token', () => {
    expect(normalizeName('T. Player')).toEqual(new Set(['t', 'player']));
  });

  test('collapses repeated whitespace instead of emitting empty tokens', () => {
    expect(normalizeName('  Magnus   Carlsen ')).toEqual(new Set(['magnus', 'carlsen']));
  });
});

describe('isNameMatch', () => {
  test('matches a name written in the same order', () => {
    expect(matches('Test Player', 'Test Player')).toBe(true);
  });

  test('matches the surname-first order tournament crosstables use', () => {
    expect(matches('Test Player', 'Player, Test')).toBe(true);
  });

  test('matches when the PGN carries a middle name the player did not type', () => {
    expect(matches('Magnus Carlsen', 'Carlsen, Magnus Oen')).toBe(true);
  });

  test('matches when the player typed more names than the PGN carries', () => {
    expect(matches('Magnus Oen Carlsen', 'Carlsen, Magnus')).toBe(true);
  });

  test('rejects a different player with a shared surname', () => {
    expect(matches('Test Player', 'Player, Anita')).toBe(false);
  });

  test('rejects an unrelated name', () => {
    expect(matches('Test Player', 'Carlsen, Magnus')).toBe(false);
  });

  test('rejects an empty name on either side rather than matching everything', () => {
    expect(matches('', 'Carlsen, Magnus')).toBe(false);
    expect(matches('Magnus Carlsen', '')).toBe(false);
    expect(matches('', '')).toBe(false);
  });
});

describe('known gap: abbreviated first names', () => {
  /**
   * Documented in the prototype carry-over notes as worth fixing when the file
   * moved. It has not been fixed, so this records the behaviour rather than the
   * intent: `{t, player}` is not a subset of `{test, player}` in
   * either direction, so the match fails and the import asks the player which
   * side they were.
   *
   * This test is expected to flip to `true` when the initials-matching story
   * lands. A failure here after that story is the fix working, not a
   * regression.
   */
  test('does not yet match an initial against the full first name', () => {
    expect(matches('Test Player', 'Player, T.')).toBe(false);
  });
});

/**
 * Which side of the board the player was on, decided from a PGN tag.
 *
 * A file we hit on day one of importing tournament games, because crosstables
 * write "Kamabathula, Sushanth" where a player types "Sushanth Kamabathula",
 * abbreviate the first name, and decorate it with a title, a federation code,
 * and a FIDE identifier. Getting it wrong reports the opponent's mistakes as
 * the player's own, which is worse than reporting nothing.
 */
import { describe, expect, test } from 'vitest';
import { isNameMatch, normalizeName, parseName } from './pgn-name-match.ts';

const matches = (user: string, pgn: string) => isNameMatch(user, pgn);

describe('normalizeName', () => {
  test('lowercases and splits on whitespace', () => {
    expect(normalizeName('Sushanth Kamabathula')).toEqual(new Set(['sushanth', 'kamabathula']));
  });

  test('drops punctuation, so a comma-reversed crosstable name tokenizes the same', () => {
    expect(normalizeName('Kamabathula, Sushanth')).toEqual(new Set(['kamabathula', 'sushanth']));
  });

  test('drops the period from an initial rather than keeping it in the token', () => {
    expect(normalizeName('S. Kamabathula')).toEqual(new Set(['s', 'kamabathula']));
  });

  test('collapses repeated whitespace instead of emitting empty tokens', () => {
    expect(normalizeName('  Magnus   Carlsen ')).toEqual(new Set(['magnus', 'carlsen']));
  });

  test('drops a title prefix rather than treating it as a name', () => {
    expect(normalizeName('GM Carlsen, Magnus')).toEqual(new Set(['carlsen', 'magnus']));
    expect(normalizeName('WIM Carlsen, Magnus')).toEqual(new Set(['carlsen', 'magnus']));
  });

  test('drops a bracketed federation code', () => {
    expect(normalizeName('Carlsen, Magnus (NOR)')).toEqual(new Set(['carlsen', 'magnus']));
    expect(normalizeName('Carlsen, Magnus [NOR]')).toEqual(new Set(['carlsen', 'magnus']));
  });

  test('drops a bare FIDE identifier', () => {
    expect(normalizeName('Carlsen, Magnus 1503014')).toEqual(new Set(['carlsen', 'magnus']));
  });
});

describe('parseName', () => {
  test('takes the surname from before the comma a crosstable writes', () => {
    expect(parseName('Kamabathula, Sushanth')).toEqual({
      surname: 'kamabathula',
      given: ['sushanth'],
    });
  });

  test('takes the surname from the last token when there is no comma', () => {
    expect(parseName('Sushanth Kamabathula')).toEqual({
      surname: 'kamabathula',
      given: ['sushanth'],
    });
  });

  test('reads a surname through a title and a federation code', () => {
    expect(parseName('GM Kamabathula, S. (IND) 1503014')).toEqual({
      surname: 'kamabathula',
      given: ['s'],
    });
  });

  test('reports a null surname for an empty name rather than throwing', () => {
    expect(parseName('')).toEqual({ surname: null, given: [] });
  });
});

describe('isNameMatch', () => {
  test('matches a name written in the same order', () => {
    expect(matches('Sushanth Kamabathula', 'Sushanth Kamabathula')).toBe(true);
  });

  test('matches the surname-first order tournament crosstables use', () => {
    expect(matches('Sushanth Kamabathula', 'Kamabathula, Sushanth')).toBe(true);
  });

  test('matches surname-first with no comma to mark it', () => {
    expect(matches('Sushanth Kamabathula', 'Kamabathula Sushanth')).toBe(true);
  });

  test('matches when the PGN carries a middle name the player did not type', () => {
    expect(matches('Magnus Carlsen', 'Carlsen, Magnus Oen')).toBe(true);
  });

  test('matches when the player typed more names than the PGN carries', () => {
    expect(matches('Magnus Oen Carlsen', 'Carlsen, Magnus')).toBe(true);
  });

  test('rejects a different player with a shared surname', () => {
    expect(matches('Sushanth Kamabathula', 'Kamabathula, Anita')).toBe(false);
  });

  test('rejects an unrelated name', () => {
    expect(matches('Sushanth Kamabathula', 'Carlsen, Magnus')).toBe(false);
  });

  test('rejects an empty name on either side rather than matching everything', () => {
    expect(matches('', 'Carlsen, Magnus')).toBe(false);
    expect(matches('Magnus Carlsen', '')).toBe(false);
    expect(matches('', '')).toBe(false);
  });
});

describe('abbreviated first names', () => {
  /**
   * DEBT-002, paid here. The assertion in this block used to record the
   * failure; it now records the fix. An initial stands for a full first name,
   * but only once the surname has matched exactly, which is what keeps the
   * loosening from becoming a match on anything.
   */
  test('matches an initial against the full first name', () => {
    expect(matches('Sushanth Kamabathula', 'Kamabathula, S.')).toBe(true);
  });

  test('matches an initial written before the surname', () => {
    expect(matches('Sushanth Kamabathula', 'S. Kamabathula')).toBe(true);
  });

  test('matches when the player is the one who abbreviated', () => {
    expect(matches('S. Kamabathula', 'Kamabathula, Sushanth')).toBe(true);
  });

  test('rejects an initial that stands for a different first name', () => {
    expect(matches('Sushanth Kamabathula', 'Kamabathula, A.')).toBe(false);
  });

  test('rejects a full first name that merely shares the initial', () => {
    expect(matches('Sushanth Kamabathula', 'Kamabathula, Anita')).toBe(false);
  });

  test('rejects an initialled surname, because a surname is never matched by a letter', () => {
    expect(matches('Sushanth Kamabathula', 'S. K.')).toBe(false);
    expect(matches('S. K.', 'Sushanth Kamabathula')).toBe(false);
  });
});

describe('decorated crosstable names', () => {
  test('matches through a title, a federation code, and a FIDE identifier', () => {
    expect(matches('Sushanth Kamabathula', 'GM Kamabathula, S. (IND) 1503014')).toBe(true);
  });

  test('still rejects a different player wearing the same decorations', () => {
    expect(matches('Sushanth Kamabathula', 'GM Kamabathula, A. (IND) 1503014')).toBe(false);
  });
});

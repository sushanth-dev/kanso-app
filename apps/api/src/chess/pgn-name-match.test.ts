/**
 * Which side of the board the player was on, decided from a PGN tag.
 *
 * A file we hit on day one of importing tournament games, because crosstables
 * write "Player, Test" where a player types "Test Player",
 * abbreviate the first name, and decorate it with a title, a federation code,
 * and a FIDE identifier. Getting it wrong reports the opponent's mistakes as
 * the player's own, which is worse than reporting nothing.
 */
import { describe, expect, test } from 'vitest';
import { isNameMatch, normalizeName, parseName } from './pgn-name-match.ts';

const matches = (user: string, pgn: string) => isNameMatch(user, pgn);

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

  test('drops a title prefix rather than treating it as a name', () => {
    expect(normalizeName('GM Carlsen, Magnus')).toEqual(new Set(['carlsen', 'magnus']));
    expect(normalizeName('WIM Carlsen, Magnus')).toEqual(new Set(['carlsen', 'magnus']));
  });

  test('drops a bracketed federation code', () => {
    expect(normalizeName('Carlsen, Magnus (NOR)')).toEqual(new Set(['carlsen', 'magnus']));
    expect(normalizeName('Carlsen, Magnus [NOR]')).toEqual(new Set(['carlsen', 'magnus']));
    expect(normalizeName('Carlsen, Magnus {NOR}')).toEqual(new Set(['carlsen', 'magnus']));
  });

  test('drops a bare FIDE identifier', () => {
    expect(normalizeName('Carlsen, Magnus 1500000')).toEqual(new Set(['carlsen', 'magnus']));
  });

  test('keeps a title-shaped token when the whole line is shouting, since case can no longer mark it as a title', () => {
    expect(normalizeName('IM SUNG HYUN')).toEqual(new Set(['im', 'sung', 'hyun']));
  });
});

describe('parseName', () => {
  test('takes the surname from before the comma a crosstable writes', () => {
    expect(parseName('Player, Test')).toEqual({
      surname: 'player',
      given: ['test'],
    });
  });

  test('takes the surname from the last token when there is no comma', () => {
    expect(parseName('Test Player')).toEqual({
      surname: 'player',
      given: ['test'],
    });
  });

  test('reads a surname through a title and a federation code', () => {
    expect(parseName('GM Player, T. (IND) 1500000')).toEqual({
      surname: 'player',
      given: ['t'],
    });
  });

  test('reports a null surname for an empty name rather than throwing', () => {
    expect(parseName('')).toEqual({ surname: null, given: [] });
  });
});

describe('isNameMatch', () => {
  test('matches a name written in the same order', () => {
    expect(matches('Test Player', 'Test Player')).toBe(true);
  });

  test('matches the surname-first order tournament crosstables use', () => {
    expect(matches('Test Player', 'Player, Test')).toBe(true);
  });

  test('matches surname-first with no comma to mark it', () => {
    expect(matches('Test Player', 'Player Test')).toBe(true);
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

describe('abbreviated first names', () => {
  /**
   * DEBT-002, paid here. The assertion in this block used to record the
   * failure; it now records the fix. An initial stands for a full first name,
   * but only once the surname has matched exactly, which is what keeps the
   * loosening from becoming a match on anything.
   */
  test('matches an initial against the full first name', () => {
    expect(matches('Test Player', 'Player, T.')).toBe(true);
  });

  test('matches an initial written before the surname', () => {
    expect(matches('Test Player', 'T. Player')).toBe(true);
  });

  test('matches when the player is the one who abbreviated', () => {
    expect(matches('T. Player', 'Player, Test')).toBe(true);
  });

  test('rejects an initial that stands for a different first name', () => {
    expect(matches('Test Player', 'Player, A.')).toBe(false);
  });

  test('rejects a full first name that merely shares the initial', () => {
    expect(matches('Test Player', 'Player, Anita')).toBe(false);
  });

  test('rejects an initialled surname, because a surname is never matched by a letter', () => {
    expect(matches('Test Player', 'T. P.')).toBe(false);
    expect(matches('T. P.', 'Test Player')).toBe(false);
  });
});

describe('decorated crosstable names', () => {
  test('matches through a title, a federation code, and a FIDE identifier', () => {
    expect(matches('Test Player', 'GM Player, T. (IND) 1500000')).toBe(true);
  });

  test('still rejects a different player wearing the same decorations', () => {
    expect(matches('Test Player', 'GM Player, A. (IND) 1500000')).toBe(false);
  });
});

describe('names that must not match', () => {
  /**
   * Each of these matched before the positional given-name comparison, the
   * capitalised-leading-title rule, and the hyphen/comma surname fixes. Every
   * one is two different people; a match here is a wrong colour shown with
   * confidence.
   */
  test('a middle initial does not answer a different first name', () => {
    expect(matches('Alan Smith', 'Smith, John A.')).toBe(false);
  });

  test('a middle initial in the crosstable does not answer the player’s first name', () => {
    expect(matches('Test Player', 'Player, Anita S.')).toBe(false);
  });

  test('a middle initial the player typed does not answer a different first name', () => {
    expect(matches('Anita T. Player', 'Player, Test')).toBe(false);
  });

  test('a Korean surname that is also a chess title is not dropped as a title', () => {
    expect(matches('Im Sung Hyun', 'Kim, Sung Hyun')).toBe(false);
  });

  test('a shouting crosstable line does not let a title-shaped surname match a different person', () => {
    expect(matches('Sung Hyun Kim', 'IM SUNG HYUN')).toBe(false);
  });

  test('a hyphenated surname is not split so its first half matches a shorter surname', () => {
    expect(matches('Anna Muller', 'Muller-Schmidt, Anna')).toBe(false);
  });

  test('a multi-token surname before the comma is not reduced to its last token', () => {
    expect(matches('Magnus Van den Berg', 'Van der Berg, M.')).toBe(false);
  });

  /**
   * DEBT-007, paid here. The order-agnostic subset path used to match on a
   * shared given name plus a surname fragment, so Magnus Berg matched Van der
   * Berg, Magnus - two different people. Path A is now anchored on the
   * surname, and this asserts both directions because the subset test is
   * symmetric.
   */
  test('a shared given name and a surname fragment do not match when the surnames differ', () => {
    expect(matches('Magnus Berg', 'Van der Berg, Magnus')).toBe(false);
    expect(matches('Van der Berg, Magnus', 'Magnus Berg')).toBe(false);
  });
});

describe('fixes did not go too far', () => {
  test('an initial in the first given-name position still matches', () => {
    expect(matches('Test Player', 'Player, T. Anita')).toBe(true);
  });

  test('a name that is also a chess title still matches its own bearer', () => {
    expect(matches('Im Sung Hyun', 'Im, Sung Hyun')).toBe(true);
  });

  test('a real title, capitalised and leading, is still dropped', () => {
    expect(matches('Sung Hyun Im', 'IM Im, Sung Hyun')).toBe(true);
  });

  test('a shouting crosstable line still matches its own bearer, title-shaped surname and all', () => {
    expect(matches('Im Sung Hyun', 'IM SUNG HYUN')).toBe(true);
  });

  test('an all-caps line with a real title still matches its own bearer', () => {
    expect(matches('Test Player', 'GM PLAYER, TEST')).toBe(true);
  });
});

describe('unicode and special characters', () => {
  /**
   * Crosstables print diacritics ("Müller, Heinz") that a player never types.
   * Before the fold, "ü" was treated as a separator and the surname shattered
   * into "m" and "ller", so an accented name could never match its ASCII
   * spelling — the player's own games silently failed to attribute.
   */
  test('folds diacritics to their ASCII skeleton', () => {
    expect(normalizeName('André Silva')).toEqual(new Set(['andre', 'silva']));
    expect(normalizeName('Müller, Heinz')).toEqual(new Set(['muller', 'heinz']));
  });

  test('matches a typed ASCII name against an accented crosstable name', () => {
    expect(matches('Andre Silva', 'Silva, André')).toBe(true);
    expect(matches('Heinz Muller', 'Müller, Heinz')).toBe(true);
  });

  test('still matches when both sides carry the accents', () => {
    expect(matches('André Silva', 'Silva, André')).toBe(true);
  });

  test('strips a curly apostrophe exactly like a straight one', () => {
    expect(normalizeName('O’Brien')).toEqual(new Set(['obrien']));
    expect(normalizeName("O'Brien")).toEqual(new Set(['obrien']));
  });

  test('a hyphen joins but other dashes separate', () => {
    expect(normalizeName('Jean-Pierre')).toEqual(new Set(['jeanpierre']));
    expect(normalizeName('Jean–Pierre')).toEqual(new Set(['jean', 'pierre']));
  });
});

describe('abbreviation and surname-anchoring edges', () => {
  test('a multi-letter abbreviation is not an initial', () => {
    expect(matches('Te Player', 'Player, Test')).toBe(false);
    expect(matches('Tes Player', 'Player, Test')).toBe(false);
  });

  /**
   * Path A deliberately lets a player who typed only their surname match a
   * namesake: the subset branch relaxes the symmetric surname check for a
   * bare given-name list. Pinned as intended, not as an accident.
   */
  test('a player who typed only their surname matches a namesake', () => {
    expect(matches('Player', 'Player, Anita')).toBe(true);
  });

  test('a surname that is only a title cannot anchor a match', () => {
    // The comma makes "GM" the stated surname; after the title trim nothing is
    // left to anchor on, so neither path may match.
    expect(matches('GM, Test', 'Test Player')).toBe(false);
  });

  test('a compound surname matches when both sides carry it fully', () => {
    expect(matches('Magnus Van der Berg', 'Van der Berg, Magnus')).toBe(true);
  });
});
describe('degenerate surname parses', () => {
  test('a comma with an empty surname states no surname at all', () => {
    // A crosstable line like ", Magnus" (or a leading separator swallowed by
    // the decoration strip) leaves nothing before the comma.
    expect(parseName(', Magnus')).toEqual({ surname: null, given: ['magnus'] });
  });

  test('a user line with no surname to anchor on does not match', () => {
    // Both match paths are anchored on a surname; with none stated, neither
    // may fire, however many given names line up.
    expect(matches(' , Magnus', 'Magnus Carlsen')).toBe(false);
    expect(matches('Magnus Carlsen', ' , Anita')).toBe(false);
  });
});

describe('extra name tokens on both sides', () => {
  test('two people sharing given and surname are still separated by their middle names', () => {
    // Both token sets overlap without either containing the other, so path A
    // declines; path B then compares the given names positionally and the
    // middle tokens disagree. Father-and-son-style lines stay distinct.
    expect(matches('Magnus Q Carlsen', 'Carlsen, Magnus Oen')).toBe(false);
  });
});

describe('unicode decomposition edges', () => {
  test('a precomposed and a decomposed accented character normalize identically', () => {
    // Å arrives as one codepoint (U+00C5) from some crosstables and as A plus
    // a combining ring (U+030A) from others; NFD folds both to the same token.
    expect(normalizeName('Åse')).toEqual(new Set(['ase']));
    expect(normalizeName('A\u030Ase')).toEqual(new Set(['ase']));
  });
});

/**
 * Match a player's own name against the `[White]` and `[Black]` tags of a PGN.
 *
 * Two names for the same person arrive in more shapes than a single rule
 * covers. A player types "Test Player". A crosstable writes
 * "Player, Test", or "Player Test" with nothing to mark which
 * token is the surname, or "GM Player, T. (IND) 1500000". So there are two
 * matching paths and either one is enough:
 *
 *   A. The subset match the prototype shipped. Order-agnostic, which is the
 *      only thing that handles a reversed name with no comma in it.
 *   B. An exact surname, then given names where a single letter stands for a
 *      full token.
 *
 * Path B is deliberately anchored on the surname, and a surname is never
 * matched by an initial. Without that anchor "T. P." would match every Test
 * Player and every Sarah Klein alike, and a wrong colour is the most
 * expensive mistake this file can make: it shows a player an analysis of their
 * opponent's play, confidently, with nothing to signal the swap.
 */

/**
 * Titles a crosstable prints in front of a name. None of them is a name, and a
 * player never types one into their profile, so keeping them would make the
 * same person fail to match themselves.
 */
const TITLES = new Set(['gm', 'im', 'fm', 'cm', 'nm', 'wgm', 'wim', 'wfm', 'wcm', 'wnm']);

/** Federation codes and identifiers ride in brackets: "(NOR)", "[2830]". */
function stripBracketed(name: string): string {
  return name.replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ');
}

/**
 * Split one segment of a name into tokens.
 *
 * A hyphen or apostrophe joins rather than separates. "Muller-Schmidt" is one
 * surname, and splitting it lets "Anna Muller" match "Muller-Schmidt, Anna" —
 * two different people. Every other punctuation mark is a separator.
 *
 * A leading title is dropped only when the source used case to set it apart
 * from the name: the first token is capitalised and the rest of the segment
 * is not also all-caps. "GM Player" marks a title this way. A crosstable
 * shouting "IM SUNG HYUN" does not — every token is capitalised alike, "Im" is
 * a Korean surname there, and deleting it would match its bearer to every
 * other Sung Hyun in the event.
 */
function cleanTokens(part: string): string[] {
  const tokens = part
    .replace(/['’‘-]/g, '')
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0 && !/^\d+$/.test(token));
  const rest = tokens.slice(1).join('');
  const titleIsMarked =
    tokens.length > 1 &&
    tokens[0] === tokens[0]!.toUpperCase() &&
    TITLES.has(tokens[0].toLowerCase()) &&
    rest !== rest.toUpperCase();
  if (titleIsMarked) {
    tokens.shift();
  }
  return tokens.map((token) => token.toLowerCase());
}

/** The tokens of a name, with the crosstable's decoration removed. */
export function normalizeName(name: string): Set<string> {
  return new Set(cleanTokens(stripBracketed(name)));
}

export interface ParsedName {
  /** Null when the name has no tokens left after the decoration is removed. */
  surname: string | null;
  given: string[];
}

/**
 * Split a name into a surname and the given names.
 *
 * A comma is the crosstable's own statement of which part is the surname, so it
 * wins where it exists. Without one, the last token is the surname, which is
 * right for "Test Player" and wrong for "Player Test" — and
 * the second of those is exactly what path A in `isNameMatch` is for.
 */
export function parseName(name: string): ParsedName {
  const stripped = stripBracketed(name);
  const comma = stripped.indexOf(',');
  if (comma >= 0) {
    // The comma is the crosstable's own statement of where the surname ends, so
    // all of it is the surname. "Van der Berg, M." is not a Berg.
    const surnameTokens = cleanTokens(stripped.slice(0, comma));
    return {
      surname: surnameTokens.length > 0 ? surnameTokens.join(' ') : null,
      given: cleanTokens(stripped.slice(comma + 1)),
    };
  }
  const tokens = cleanTokens(stripped);
  return { surname: tokens.at(-1) ?? null, given: tokens.slice(0, -1) };
}

/** A single letter stands for a full token that begins with it, either way round. */
function tokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 1) return b.startsWith(a);
  if (b.length === 1) return a.startsWith(b);
  return false;
}

/**
 * Given names compared in order, a single letter standing for the token in the
 * same position. Position is the point: without it a middle initial answers a
 * first name, and "Alan Smith" matches "Smith, John A." — two different people
 * with one wrong colour between them.
 *
 * A name with no given names at all is not a match here. Path A already handles
 * a player who typed only their surname; letting an empty list match vacuously
 * would attach them to every namesake in the event.
 */
function givenMatches(a: string[], b: string[]): boolean {
  const shared = Math.min(a.length, b.length);
  if (shared === 0) return false;
  for (let i = 0; i < shared; i++) {
    if (!tokenMatches(a[i]!, b[i]!)) return false;
  }
  return true;
}

/**
 * A comma-bearing name states its surname, and that surname must appear as a
 * contiguous token sequence in the other name for the two to correspond. A name
 * with no comma states no surname and cannot anchor. Leading title tokens are
 * stripped from the stated surname, so "GM PLAYER, TEST" still matches
 * "Test Player".
 */
function surnameAppearsContiguously(surname: string | null, tokens: string[]): boolean {
  if (surname === null) return false;
  const seq = surname.split(' ');
  let start = 0;
  while (start < seq.length - 1 && TITLES.has(seq[start]!)) start++;
  const trimmed = seq.slice(start);
  if (trimmed.length === 0) return false;
  outer: for (let i = 0; i <= tokens.length - trimmed.length; i++) {
    for (let j = 0; j < trimmed.length; j++) {
      if (tokens[i + j] !== trimmed[j]) continue outer;
    }
    return true;
  }
  return false;
}

export function isNameMatch(user: string, pgn: string): boolean {
  const userTokens = normalizeName(user);
  const pgnTokens = normalizeName(pgn);
  if (userTokens.size === 0 || pgnTokens.size === 0) return false;

  const mine = parseName(user);
  const theirs = parseName(pgn);

  // Path A: the prototype's subset match, over a tokenizer that now strips
  // brackets, titles, and identifiers. Order does not matter here, which is
  // what catches a reversed name with no comma. It is anchored on the surname:
  // a comma-bearing name states its surname, and that surname must appear
  // contiguously in the other name, or the two are different people who happen
  // to share a given name and a surname fragment.
  const userIsSubset = Array.from(userTokens).every((token) => pgnTokens.has(token));
  const pgnIsSubset = Array.from(pgnTokens).every((token) => userTokens.has(token));
  if (
    (userIsSubset || pgnIsSubset) &&
    surnameAppearsContiguously(mine.surname, Array.from(pgnTokens)) &&
    surnameAppearsContiguously(theirs.surname, Array.from(userTokens))
  ) {
    return true;
  }

  // Path B: an exact surname, then given names with initials expanded. The
  // surname comparison is exact on purpose; an initial never stands for it.
  if (mine.surname === null || theirs.surname === null) return false;
  if (mine.surname !== theirs.surname) return false;
  return givenMatches(mine.given, theirs.given);
}

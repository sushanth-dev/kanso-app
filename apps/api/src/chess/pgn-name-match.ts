/**
 * Match a player's own name against the `[White]` and `[Black]` tags of a PGN.
 *
 * Two names for the same person arrive in more shapes than a single rule
 * covers. A player types "Sushanth Kamabathula". A crosstable writes
 * "Kamabathula, Sushanth", or "Kamabathula Sushanth" with nothing to mark which
 * token is the surname, or "GM Kamabathula, S. (IND) 1503014". So there are two
 * matching paths and either one is enough:
 *
 *   A. The subset match the prototype shipped. Order-agnostic, which is the
 *      only thing that handles a reversed name with no comma in it.
 *   B. An exact surname, then given names where a single letter stands for a
 *      full token.
 *
 * Path B is deliberately anchored on the surname, and a surname is never
 * matched by an initial. Without that anchor "S. K." would match every Sushanth
 * Kamabathula and every Sarah Klein alike, and a wrong colour is the most
 * expensive mistake this file can make: it shows a player an analysis of their
 * opponent's play, confidently, with nothing to signal the swap.
 */

/**
 * Titles a crosstable prints in front of a name. None of them is a name, and a
 * player never types one into their profile, so keeping them would make the
 * same person fail to match themselves.
 */
const TITLES = new Set(['gm', 'im', 'fm', 'cm', 'nm', 'wgm', 'wim', 'wfm', 'wcm', 'wnm']);

/**
 * Federation codes and identifiers ride in brackets: "(NOR)", "[2830]". The
 * expression is fixed and non-nesting, so a long adversarial name costs time
 * linear in its length rather than exponential.
 */
function stripBracketed(name: string): string {
  return name.replace(/[([{][^)\]}]*[)\]}]/g, ' ');
}

/**
 * Lowercase, drop punctuation, and split. Titles and bare FIDE identifiers go
 * with it: both are metadata about a player rather than part of their name.
 */
function cleanTokens(part: string): string[] {
  return part
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0 && !TITLES.has(token) && !/^\d+$/.test(token));
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
 * right for "Sushanth Kamabathula" and wrong for "Kamabathula Sushanth" — and
 * the second of those is exactly what path A in `isNameMatch` is for.
 */
export function parseName(name: string): ParsedName {
  const stripped = stripBracketed(name);
  const comma = stripped.indexOf(',');
  if (comma >= 0) {
    const surnameTokens = cleanTokens(stripped.slice(0, comma));
    return {
      surname: surnameTokens.at(-1) ?? null,
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

/** Every token in `a` is answered by some token in `b`. Extra tokens in `b` are fine. */
function covered(a: string[], b: string[]): boolean {
  return a.every((token) => b.some((other) => tokenMatches(token, other)));
}

export function isNameMatch(user: string, pgn: string): boolean {
  const userTokens = normalizeName(user);
  const pgnTokens = normalizeName(pgn);
  if (userTokens.size === 0 || pgnTokens.size === 0) return false;

  // Path A: the prototype's subset match, unchanged in behaviour. Order does
  // not matter here, which is what catches a reversed name with no comma.
  const userIsSubset = Array.from(userTokens).every((token) => pgnTokens.has(token));
  const pgnIsSubset = Array.from(pgnTokens).every((token) => userTokens.has(token));
  if (userIsSubset || pgnIsSubset) return true;

  // Path B: an exact surname, then given names with initials expanded. The
  // surname comparison is exact on purpose; an initial never stands for it.
  const mine = parseName(user);
  const theirs = parseName(pgn);
  if (mine.surname === null || theirs.surname === null) return false;
  if (mine.surname !== theirs.surname) return false;
  return covered(mine.given, theirs.given) || covered(theirs.given, mine.given);
}

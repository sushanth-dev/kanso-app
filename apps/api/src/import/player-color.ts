/**
 * Which side of the board the player was on, decided by name.
 *
 * ST-002 does the exact match the prototype's tokens already support and
 * returns null when it cannot decide. Null is not a failure: it is the "side
 * not yet determined" state (Option A), which ST-003 both fills in for the
 * cases this misses and tightens for abbreviated names (DEBT-002). A match on
 * both sides or on neither is null on purpose — a guessed colour shows a player
 * an analysis of their opponent.
 */
import { isNameMatch, normalizeName } from '../chess/pgn-name-match.ts';

export function decidePlayerColor(
  displayName: string,
  whiteName: string | null,
  blackName: string | null,
): 'white' | 'black' | null {
  const player = normalizeName(displayName);
  const isWhite = whiteName != null && isNameMatch(player, normalizeName(whiteName));
  const isBlack = blackName != null && isNameMatch(player, normalizeName(blackName));
  if (isWhite === isBlack) return null; // both or neither: do not guess
  return isWhite ? 'white' : 'black';
}

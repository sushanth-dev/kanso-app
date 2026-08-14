/**
 * ST-018. The Chess.com rating fetch.
 *
 * One module per external provider (ADR-0018): direct `fetch`, no SDK, one
 * public function. `null` is the "unknown" answer and is returned, never
 * thrown, for a username that fails the charset check, a non-200, a timeout, a
 * network error, or a malformed body, so a player with a bad username or a
 * briefly-down upstream degrades to "unknown" rather than a crash.
 */
import { RATING_FETCH_TIMEOUT_MS, RATING_MAX, RATING_MIN } from './constants.ts';

/**
 * Chess.com usernames are 3-25 characters of letters, digits, underscore, or
 * hyphen. The check is the boundary: a username that fails it is rejected
 * before it reaches the URL, and `encodeURIComponent` only ever sees a
 * username this pattern has already accepted.
 */
const CHESSCOM_USERNAME = /^[A-Za-z0-9_-]{3,25}$/;

const CHESSCOM_STATS_URL = 'https://api.chess.com/pub/player';

export function isPlausibleChesscomUsername(username: string): boolean {
  return CHESSCOM_USERNAME.test(username);
}

/**
 * The player's current rapid rating, or null when it cannot be determined.
 * Rapid is the closest online time control to classical over the board.
 */
export async function fetchChesscomRating(username: string): Promise<number | null> {
  if (!isPlausibleChesscomUsername(username)) return null;

  const url = `${CHESSCOM_STATS_URL}/${encodeURIComponent(username)}/stats`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(RATING_FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as { chess_rapid?: { last?: { rating?: unknown } } };
    const rating = body.chess_rapid?.last?.rating;
    return typeof rating === 'number' &&
      Number.isInteger(rating) &&
      rating >= RATING_MIN &&
      rating <= RATING_MAX
      ? rating
      : null;
  } catch {
    return null;
  }
}

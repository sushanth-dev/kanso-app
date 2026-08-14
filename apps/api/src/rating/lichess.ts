/**
 * ST-018. The Lichess rating fetch.
 *
 * One module per external provider (ADR-0018): direct `fetch`, no SDK, one
 * public function. `null` is the "unknown" answer and is returned, never
 * thrown, for a username that fails the charset check, a non-200, a timeout, a
 * network error, or a malformed body.
 */
import { RATING_FETCH_TIMEOUT_MS, RATING_MAX, RATING_MIN } from './constants.ts';

/**
 * Lichess usernames are 2-20 characters of letters, digits, underscore, or
 * hyphen, matched case-insensitively by the API. The check is the boundary: a
 * username that fails it is rejected before it reaches the URL.
 */
const LICHESS_USERNAME = /^[A-Za-z0-9_-]{2,20}$/;

const LICHESS_USER_URL = 'https://lichess.org/api/user';

export function isPlausibleLichessUsername(username: string): boolean {
  return LICHESS_USERNAME.test(username);
}

/**
 * The player's current rapid rating, or null when it cannot be determined.
 */
export async function fetchLichessRating(username: string): Promise<number | null> {
  if (!isPlausibleLichessUsername(username)) return null;

  const url = `${LICHESS_USER_URL}/${encodeURIComponent(username)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(RATING_FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as { perfs?: { rapid?: { rating?: unknown } } };
    const rating = body.perfs?.rapid?.rating;
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

/**
 * ST-018. The shared bounds for the rating fetch and snapshot.
 *
 * A rating fetch is one fast public API call, so a five-second timeout is
 * plenty. The snapshot TTL means a view re-fetches at most once a day, and a
 * deliberate refresh (`refresh=true`) is the only way to force it sooner.
 */
export const RATING_FETCH_TIMEOUT_MS = 5_000;

export const RATING_TTL_SECONDS = 24 * 60 * 60;

/**
 * A sane range for an online rating. Loose on purpose: the check exists to
 * keep a malformed response out of the database, not to argue with the
 * platforms about what the ceiling is.
 */
export const RATING_MIN = 0;
export const RATING_MAX = 4_000;

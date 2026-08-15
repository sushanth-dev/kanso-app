/**
 * ST-023. Shared bounds for the provider game fetch.
 *
 * A games export is a bulk download that can span many pages, so the
 * per-request timeout is longer than the rating fetch's five seconds. The page
 * size and the per-provider request delays live in the provider modules, where
 * each platform's limit is.
 */
export const GAME_FETCH_TIMEOUT_MS = 30_000;

/**
 * ST-023. Shared bounds for the provider game fetch.
 *
 * A games export is a bulk download that can span many pages, so the
 * per-request timeout is longer than the rating fetch's five seconds. The page
 * size and the per-provider request delays live in the provider modules, where
 * each platform's limit is.
 */
export const GAME_FETCH_TIMEOUT_MS = 30_000;

/**
 * DEBT-011. The online import daily volume cap, in games per rolling 24-hour
 * window per player. Pinned at 20 on Sushanth's decision, tighter than the
 * 30-50 band in `project/docs/analysis-cost.md`, so one day's online import
 * costs at most $0.22 of compute at ADR-0023's 1.1 cents a game.
 */
export const ONLINE_IMPORT_DAILY_CAP_GAMES = 20;

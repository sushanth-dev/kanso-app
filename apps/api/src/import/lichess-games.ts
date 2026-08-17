/**
 * ST-023. The Lichess game fetch.
 *
 * One module per external provider (ADR-0018): direct `fetch`, no SDK. The
 * games endpoint pages newest-first with `since`/`until` in milliseconds and a
 * `max` of 500 per page; with `Accept: application/x-chess-pgn` and
 * `clocks=true` each page is a multi-game PGN whose movetext carries `%clk`.
 * The provider's game id rides in the `[GameId]` tag, falling back to the
 * `[Site]` tag's URL.
 *
 * `ok: false` is returned, never thrown, for a username that fails the charset
 * check, a 404, a non-200, a timeout, a network error, or a malformed body.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { isPlausibleLichessUsername } from '../rating/lichess.ts';
import { GAME_FETCH_TIMEOUT_MS } from './game-fetch-constants.ts';
import type { FetchGamesOutcome, ProviderGame } from './game-fetcher.ts';
import { splitGames } from './parse-pgn.ts';

const LICHESS_GAMES_URL = 'https://lichess.org/api/games/user';

// Lichess asks bulk export callers to stay well under the abuse threshold; one
// page per second is conservative and keeps a season import at a few seconds.
const LICHESS_PAGE_SIZE = 500;
const LICHESS_REQUEST_DELAY_MS = 1_000;

/** `[GameId "gameid01"]` → `gameid01`, else `[Site "https://lichess.org/gameid01"]`. */
function gameIdFromPgn(pgn: string): string | null {
  const byTag = /^\[GameId "([^"]+)"\]$/m.exec(pgn);
  if (byTag) return byTag[1] ?? null;
  const bySite = /^\[Site "https:\/\/lichess\.org\/([^"]+)"\]$/m.exec(pgn);
  return bySite ? (bySite[1] ?? null) : null;
}

/** `[UTCDate "2026.04.08"]` + `[UTCTime "19:39:03"]` → epoch ms, for the next page's `until`. */
function gameTimestampMs(pgn: string): number | null {
  const date = /^\[UTCDate "(\d{4})\.(\d{2})\.(\d{2})"\]$/m.exec(pgn);
  const time = /^\[UTCTime "(\d{2}):(\d{2}):(\d{2})"\]$/m.exec(pgn);
  if (!date || !time) return null;
  return Date.UTC(
    Number(date[1]),
    Number(date[2]) - 1,
    Number(date[3]),
    Number(time[1]),
    Number(time[2]),
    Number(time[3]),
  );
}

export async function fetchLichessGames(
  username: string,
  since: Date,
  maxGames: number,
): Promise<FetchGamesOutcome> {
  if (!isPlausibleLichessUsername(username)) {
    return { ok: false, code: 'username_not_found' };
  }

  const sinceMs = since.getTime();
  let untilMs = Date.now();
  const games: ProviderGame[] = [];

  try {
    // Newest-first pages: each page moves the window back with the oldest
    // game's start time, stopping at `since`, `maxGames`, or a short page.
    while (untilMs > sinceMs) {
      // Ask Lichess for the cap's worth of games, not a full 500-game page, so
      // a 20-game import does not download and discard a season's first page.
      const max = Math.min(LICHESS_PAGE_SIZE, maxGames);
      const url = `${LICHESS_GAMES_URL}/${encodeURIComponent(username)}?since=${sinceMs}&until=${untilMs}&max=${max}&clocks=true`;
      const res = await fetch(url, {
        headers: {
          Accept: 'application/x-chess-pgn',
          // Lichess soft-blocks the default curl/undici User-Agent with a 404,
          // so the fetch identifies the app rather than presenting a bot UA.
          'User-Agent': 'kansochess/1.0',
        },
        signal: AbortSignal.timeout(GAME_FETCH_TIMEOUT_MS),
      });
      if (res.status === 404) return { ok: false, code: 'username_not_found' };
      if (!res.ok) return { ok: false, code: 'upstream_error' };

      const chunks = splitGames(await res.text());
      if (chunks.length === 0) break;

      let oldestMs: number | null = null;
      for (const chunk of chunks) {
        games.push({ externalId: gameIdFromPgn(chunk), pgn: chunk });
        const ts = gameTimestampMs(chunk);
        if (ts !== null && (oldestMs === null || ts < oldestMs)) oldestMs = ts;
      }

      if (games.length >= maxGames) break;
      if (chunks.length < max) break;
      if (oldestMs === null || oldestMs >= untilMs) break;
      untilMs = oldestMs;
      await sleep(LICHESS_REQUEST_DELAY_MS);
    }

    return { ok: true, games: games.slice(0, maxGames) };
  } catch {
    return { ok: false, code: 'upstream_error' };
  }
}

/**
 * ST-023. The Chess.com game fetch.
 *
 * One module per external provider (ADR-0018): direct `fetch`, no SDK. Games
 * come back as per-month archives, so the fetch walks the archive list and
 * pulls only the months at or after `since`. Each archive is a JSON page whose
 * games carry their own PGN and a `url` whose last segment is the provider's
 * game id.
 *
 * `ok: false` is returned, never thrown, for a username that fails the charset
 * check (rejected before it reaches the URL), a 404, a non-200, a timeout, a
 * network error, or a malformed body.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { isPlausibleChesscomUsername } from '../rating/chesscom.ts';
import { GAME_FETCH_TIMEOUT_MS } from './game-fetch-constants.ts';
import type { FetchGamesOutcome, ProviderGame } from './game-fetcher.ts';

const CHESSCOM_ARCHIVES_URL = 'https://api.chess.com/pub/player';

// Chess.com publishes no hard per-second limit but asks callers to stay slow.
// One archive per ~500ms keeps a season import at a few seconds and is far
// inside what the platform tolerates.
const CHESSCOM_REQUEST_DELAY_MS = 500;

/** `https://www.chess.com/game/live/172385979790` → `172385979790`. */
function gameIdFromUrl(url: string): string | null {
  const last = url.split('/').at(-1);
  return last === undefined || last === '' ? null : last;
}

/** `.../games/2026/08` → 202608, for filtering archives to the period. */
function monthFromArchiveUrl(url: string): number | null {
  const match = /\/games\/(\d{4})\/(\d{2})$/.exec(url);
  return match ? Number(match[1]) * 100 + Number(match[2]) : null;
}

export async function fetchChesscomGames(
  username: string,
  since: Date,
): Promise<FetchGamesOutcome> {
  if (!isPlausibleChesscomUsername(username)) {
    return { ok: false, code: 'username_not_found' };
  }

  const sinceMonth = since.getUTCFullYear() * 100 + (since.getUTCMonth() + 1);
  const archivesUrl = `${CHESSCOM_ARCHIVES_URL}/${encodeURIComponent(username)}/games/archives`;

  try {
    const archivesRes = await fetch(archivesUrl, {
      signal: AbortSignal.timeout(GAME_FETCH_TIMEOUT_MS),
    });
    if (archivesRes.status === 404) return { ok: false, code: 'username_not_found' };
    if (!archivesRes.ok) return { ok: false, code: 'upstream_error' };
    const { archives } = (await archivesRes.json()) as { archives?: string[] };
    if (!Array.isArray(archives)) return { ok: false, code: 'upstream_error' };

    const months = archives.filter((url) => {
      const month = monthFromArchiveUrl(url);
      return month !== null && month >= sinceMonth;
    });

    const games: ProviderGame[] = [];
    for (const monthUrl of months) {
      const res = await fetch(monthUrl, {
        signal: AbortSignal.timeout(GAME_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return { ok: false, code: 'upstream_error' };
      const body = (await res.json()) as { games?: Array<{ url?: string; pgn?: string }> };
      if (!Array.isArray(body.games)) return { ok: false, code: 'upstream_error' };

      for (const raw of body.games) {
        if (typeof raw.pgn !== 'string' || raw.pgn.trim() === '') continue;
        games.push({
          externalId: raw.url ? gameIdFromUrl(raw.url) : null,
          pgn: raw.pgn,
        });
      }
      await sleep(CHESSCOM_REQUEST_DELAY_MS);
    }

    return { ok: true, games };
  } catch {
    return { ok: false, code: 'upstream_error' };
  }
}

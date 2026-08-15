/**
 * ST-029. The stubbed provider for the Playwright import journey.
 *
 * The provider call happens server-side in the API, so browser route
 * interception cannot reach it. The e2e run instead sets `IMPORT_PROVIDER_STUB`
 * and this fetcher replaces the real outbound call with the same captured
 * fixtures the unit tests use. It is test infrastructure: nothing here runs in
 * production.
 */
import { readFileSync } from 'node:fs';
import { splitGames } from './parse-pgn.ts';
import type { FetchGamesOutcome, GameFetcher, ProviderGame } from './game-fetcher.ts';

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const lichessId = (pgn: string): string | null => {
  const byTag = /^\[GameId "([^"]+)"\]$/m.exec(pgn);
  if (byTag) return byTag[1] ?? null;
  const bySite = /^\[Site "https:\/\/lichess\.org\/([^"]+)"\]$/m.exec(pgn);
  return bySite?.[1] ?? null;
};

function chesscomGames(): ProviderGame[] {
  const body = JSON.parse(fixture('chesscom-games.json')) as {
    games?: Array<{ url?: string; pgn?: string }>;
  };
  return (body.games ?? [])
    .filter((raw) => typeof raw.pgn === 'string' && raw.pgn.trim() !== '')
    .map((raw) => ({
      externalId: raw.url ? (raw.url.split('/').at(-1) ?? null) : null,
      pgn: raw.pgn as string,
    }));
}

function lichessGames(): ProviderGame[] {
  return splitGames(fixture('lichess-games.pgn')).map((pgn) => ({
    externalId: lichessId(pgn),
    pgn,
  }));
}

const gamesBySource: Record<'chesscom' | 'lichess', ProviderGame[]> = {
  chesscom: chesscomGames(),
  lichess: lichessGames(),
};

export const fixtureGameFetcher: GameFetcher = {
  chesscom: () => Promise.resolve<FetchGamesOutcome>({ ok: true, games: gamesBySource.chesscom }),
  lichess: () => Promise.resolve<FetchGamesOutcome>({ ok: true, games: gamesBySource.lichess }),
};

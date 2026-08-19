import createClient from 'openapi-fetch';
import type { components, paths } from '../generated/api.ts';
import { apiBaseUrl } from './base-url.ts';
import { failure } from './account-api.ts';
import type { Stream } from './diagnosis-api.ts';

export type ImportJob = components['schemas']['ImportJob'];
export type ImportSource = 'chesscom' | 'lichess' | 'pgn_upload' | 'uscf';

/**
 * The username shapes the API already enforces at its own boundary; mirror
 * them so the form rejects an implausible username before any request. Source:
 * apps/api/src/rating/chesscom.ts and lichess.ts. Keep in sync if the API
 * widens.
 */
export const CHESSCOM_USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,25}$/;
export const LICHESS_USERNAME_PATTERN = /^[A-Za-z0-9_-]{2,20}$/;

export function isPlausibleChesscomUsername(username: string): boolean {
  return CHESSCOM_USERNAME_PATTERN.test(username);
}

export function isPlausibleLichessUsername(username: string): boolean {
  return LICHESS_USERNAME_PATTERN.test(username);
}

/**
 * The shape the form submits. One branch per import method; `stream` is
 * stated by the form only for a PGN upload because a username import is always
 * online and a tournament is always tournament.
 */
export type StartImportBody =
  | { source: 'chesscom'; username: string }
  | { source: 'lichess'; username: string }
  | { source: 'pgn_upload'; pgn: string; stream: Stream }
  | { source: 'uscf'; tournamentName: string; playerName: string };

export interface ImportApi {
  startImport(playerId: string, body: StartImportBody): Promise<ImportJob>;
}

export function createImportApi(fetcher: typeof globalThis.fetch = globalThis.fetch): ImportApi {
  const client = createClient<paths>({
    baseUrl: apiBaseUrl,
    fetch: fetcher,
    credentials: 'include',
  });
  return {
    async startImport(playerId, body) {
      const payload: components['schemas']['StartImport'] =
        body.source === 'chesscom'
          ? { source: 'chesscom', username: body.username, stream: 'online' }
          : body.source === 'lichess'
            ? { source: 'lichess', username: body.username, stream: 'online' }
            : body.source === 'pgn_upload'
              ? { source: 'pgn_upload', pgn: body.pgn, stream: body.stream }
              : {
                  source: 'uscf',
                  tournamentName: body.tournamentName,
                  playerName: body.playerName,
                  stream: 'tournament',
                };
      const result = await client.POST('/players/{playerId}/imports', {
        params: { path: { playerId } },
        body: payload,
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
  };
}

export const importApi = createImportApi();

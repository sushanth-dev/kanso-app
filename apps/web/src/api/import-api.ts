import createClient from 'openapi-fetch';
import type { components, paths } from '../generated/api.ts';
import { apiBaseUrl } from './base-url.ts';
import { failure } from './account-api.ts';
import type { Stream } from './diagnosis-api.ts';

export type ImportJob = components['schemas']['ImportJob'];
export type ImportSource = 'chesscom' | 'lichess' | 'pgn_upload';

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
 * stated by the form only for a PGN upload because a username import is
 * always online.
 */
export type StartImportBody =
  | { source: 'chesscom'; username: string }
  | { source: 'lichess'; username: string }
  | { source: 'pgn_upload'; pgn: string; stream: Stream };

export interface ImportApi {
  startImport(body: StartImportBody): Promise<ImportJob>;
}

export function createImportApi(fetcher: typeof globalThis.fetch = globalThis.fetch): ImportApi {
  const client = createClient<paths>({
    baseUrl: apiBaseUrl,
    fetch: fetcher,
    credentials: 'include',
  });
  return {
    async startImport(body) {
      const payload: components['schemas']['StartImport'] =
        body.source === 'chesscom'
          ? { source: 'chesscom', username: body.username, stream: 'online' }
          : body.source === 'lichess'
            ? { source: 'lichess', username: body.username, stream: 'online' }
            : { source: 'pgn_upload', pgn: body.pgn, stream: body.stream };
      const result = await client.POST('/imports', { body: payload });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
  };
}

export const importApi = createImportApi();

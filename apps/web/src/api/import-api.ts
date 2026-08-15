import createClient from 'openapi-fetch';
import type { components, paths } from '../generated/api.ts';
import { failure } from './account-api.ts';

export type ImportJob = components['schemas']['ImportJob'];
export type ImportSource = 'chesscom' | 'lichess';

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

/** The shape the form submits; the stream is always online for a username import. */
export interface StartImportBody {
  source: ImportSource;
  username: string;
}

export interface ImportApi {
  startImport(playerId: string, body: StartImportBody): Promise<ImportJob>;
}

export function createImportApi(fetcher: typeof globalThis.fetch = globalThis.fetch): ImportApi {
  const client = createClient<paths>({
    baseUrl: window.location.origin,
    fetch: fetcher,
    credentials: 'same-origin',
  });
  return {
    async startImport(playerId, body) {
      const payload: components['schemas']['StartImport'] =
        body.source === 'chesscom'
          ? { source: 'chesscom', username: body.username, stream: 'online' }
          : { source: 'lichess', username: body.username, stream: 'online' };
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

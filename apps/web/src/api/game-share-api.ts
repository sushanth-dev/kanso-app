import createClient from 'openapi-fetch';
import type { components, paths } from '../generated/api.ts';
import { apiBaseUrl } from './base-url.ts';
import { failure } from './account-api.ts';

export type GameShareLink = components['schemas']['GameShareLink'];
export type SharedGame = components['schemas']['SharedGame'];

export interface CreateGameShareLinkBody {
  expiresAt?: string;
}

export interface GameShareApi {
  listGameShareLinks(gameId: string): Promise<GameShareLink[]>;
  createGameShareLink(gameId: string, body: CreateGameShareLinkBody): Promise<GameShareLink>;
  revokeGameShareLink(gameId: string, shareLinkId: string): Promise<void>;
}

export function createGameShareApi(
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): GameShareApi {
  const client = createClient<paths>({
    baseUrl: apiBaseUrl,
    fetch: fetcher,
    credentials: 'include',
  });
  return {
    async listGameShareLinks(gameId) {
      const result = await client.GET('/games/{gameId}/share-links', {
        params: { path: { gameId } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async createGameShareLink(gameId, body) {
      const result = await client.POST('/games/{gameId}/share-links', {
        params: { path: { gameId } },
        body,
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async revokeGameShareLink(gameId, shareLinkId) {
      const result = await client.DELETE('/games/{gameId}/share-links/{shareLinkId}', {
        params: { path: { gameId, shareLinkId } },
      });
      if (result.response.status === 204) return;
      throw failure(result.response.status, result.error);
    },
  };
}

export const gameShareApi = createGameShareApi();

export interface SharedGameApi {
  getShared(token: string): Promise<SharedGame>;
}

/**
 * The public read is credential-free, like the shared assignment: a forwarded
 * link is opened by someone with no session, so the fetch must not attach the
 * session cookie. There is no confirm act - viewing is the whole link.
 */
export function createSharedGameApi(
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): SharedGameApi {
  const read = createClient<paths>({
    baseUrl: apiBaseUrl,
    fetch: fetcher,
    credentials: 'omit',
  });
  return {
    async getShared(token) {
      const result = await read.GET('/shared/games/{token}', {
        params: { path: { token } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
  };
}

export const sharedGameApi = createSharedGameApi();

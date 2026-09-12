import createClient from 'openapi-fetch';
import type { components, paths } from '../generated/api.ts';
import { apiBaseUrl } from './base-url.ts';
import { failure } from './account-api.ts';

export type EngineReply = components['schemas']['EngineReply'];
export type EngineReplyRequest = components['schemas']['EngineReplyRequest'];

export interface FinishGameApi {
  engineReply(gameId: string, body: EngineReplyRequest): Promise<EngineReply>;
}

/**
 * ST-158. The finish-your-own-game session's one call: the opponent's reply
 * once the player has left the game's stored tree. Credential-bearing like
 * every account call; the rails playback is client-side and never hits the
 * network.
 */
export function createFinishGameApi(
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): FinishGameApi {
  const client = createClient<paths>({
    baseUrl: apiBaseUrl,
    fetch: fetcher,
    credentials: 'include',
  });
  return {
    async engineReply(gameId, body) {
      const result = await client.POST('/games/{gameId}/engine-reply', {
        params: { path: { gameId } },
        body,
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
  };
}

export const finishGameApi = createFinishGameApi();

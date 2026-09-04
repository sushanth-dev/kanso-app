import createClient from 'openapi-fetch';
import type { paths } from '../generated/api.ts';
import { apiBaseUrl } from './base-url.ts';
import { failure } from './account-api.ts';

export interface NudgeApi {
  unsubscribe(token: string): Promise<void>;
}

/**
 * The unsubscribe link is opened by a player with no session, so the fetch
 * must not attach the session cookie: `credentials: 'omit'` forces that even
 * on the same origin (the same posture as the guardian confirm call).
 */
export function createNudgeApi(fetcher: typeof globalThis.fetch = globalThis.fetch): NudgeApi {
  const client = createClient<paths>({
    baseUrl: apiBaseUrl,
    fetch: fetcher,
    credentials: 'omit',
  });
  return {
    async unsubscribe(token) {
      const result = await client.GET('/nudge/unsubscribe/{token}', {
        params: { path: { token } },
      });
      if (result.response.status === 204) return;
      throw failure(result.response.status, result.error);
    },
  };
}

export const nudgeApi = createNudgeApi();

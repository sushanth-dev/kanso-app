import createClient from 'openapi-fetch';
import type { paths } from '../generated/api.ts';
import { apiBaseUrl } from './base-url.ts';
import { failure } from './account-api.ts';

export interface GuardianApi {
  confirmGuardian(token: string): Promise<void>;
}

/**
 * The consent link is opened by a guardian with no session, so the fetch must
 * not attach the session cookie: `credentials: 'omit'` forces that even on the
 * same origin (the same posture as the public proof-sheet read).
 */
export function createGuardianApi(
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): GuardianApi {
  const client = createClient<paths>({
    baseUrl: apiBaseUrl,
    fetch: fetcher,
    credentials: 'omit',
  });
  return {
    async confirmGuardian(token) {
      const result = await client.GET('/guardians/confirm/{token}', {
        params: { path: { token } },
      });
      if (result.response.status === 204) return;
      throw failure(result.response.status, result.error);
    },
  };
}

export const guardianApi = createGuardianApi();

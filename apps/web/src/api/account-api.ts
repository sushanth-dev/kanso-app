import createClient from 'openapi-fetch';
import type { components, paths } from '../generated/api.ts';
import { apiBaseUrl } from './base-url.ts';

export type Me = components['schemas']['Me'];
export type SessionState = components['schemas']['SessionState'];
export type Player = components['schemas']['Player'];
export type UpdatePlayer = components['schemas']['UpdatePlayer'];
export type ApiError = components['schemas']['ApiError'];
export type Tier = components['schemas']['Tier'];

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly issues: ApiError['issues'],
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export function failure(status: number, body: ApiError | undefined): ApiRequestError {
  return new ApiRequestError(
    status,
    body?.code ?? 'request_failed',
    body?.issues,
    body?.message ?? 'The request failed.',
  );
}

export interface AccountApi {
  getSession(): Promise<SessionState>;
  getMe(): Promise<Me>;
  updateMe(body: UpdatePlayer): Promise<Player>;
  deleteMe(body: { password: string }): Promise<void>;
}

export function createAccountApi(fetcher: typeof globalThis.fetch = globalThis.fetch): AccountApi {
  const client = createClient<paths>({
    baseUrl: apiBaseUrl,
    fetch: fetcher,
    credentials: 'include',
  });
  return {
    async getSession(): Promise<SessionState> {
      const result = await client.GET('/session');
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async getMe(): Promise<Me> {
      const result = await client.GET('/me');
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async updateMe(body: UpdatePlayer): Promise<Player> {
      const result = await client.PATCH('/me', { body });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async deleteMe(body: { password: string }): Promise<void> {
      const result = await client.DELETE('/account', { body });
      if (result.response.status === 204) return;
      throw failure(result.response.status, result.error);
    },
  };
}

export const accountApi = createAccountApi();

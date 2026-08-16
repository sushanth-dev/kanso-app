import createClient from 'openapi-fetch';
import type { components, paths } from '../generated/api.ts';

export type Me = components['schemas']['Me'];
export type Player = components['schemas']['Player'];
export type CreatePlayer = components['schemas']['CreatePlayer'];
export type UpdatePlayer = components['schemas']['UpdatePlayer'];
export type ApiError = components['schemas']['ApiError'];

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
  getMe(): Promise<Me>;
  createPlayer(body: CreatePlayer): Promise<Player>;
  updatePlayer(playerId: string, body: UpdatePlayer): Promise<Player>;
}

export function createAccountApi(fetcher: typeof globalThis.fetch = globalThis.fetch): AccountApi {
  const client = createClient<paths>({
    baseUrl: window.location.origin,
    fetch: fetcher,
    credentials: 'same-origin',
  });
  return {
    async getMe(): Promise<Me> {
      const result = await client.GET('/me');
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async createPlayer(body: CreatePlayer): Promise<Player> {
      const result = await client.POST('/players', { body });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async updatePlayer(playerId: string, body: UpdatePlayer): Promise<Player> {
      const result = await client.PATCH('/players/{playerId}', {
        params: { path: { playerId } },
        body,
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
  };
}

export const accountApi = createAccountApi();

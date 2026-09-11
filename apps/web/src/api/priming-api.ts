import createClient from 'openapi-fetch';
import type { components, paths } from '../generated/api.ts';
import { apiBaseUrl } from './base-url.ts';
import { failure } from './account-api.ts';

export type PrimingToken = components['schemas']['PrimingToken'];
export type PrimingTokenWithSecret = components['schemas']['PrimingTokenWithSecret'];

export interface PrimingApi {
  listPrimingTokens(): Promise<PrimingToken[]>;
  createPrimingToken(): Promise<PrimingTokenWithSecret>;
  revokePrimingToken(tokenId: string): Promise<void>;
}

export function createPrimingApi(fetcher: typeof globalThis.fetch = globalThis.fetch): PrimingApi {
  const client = createClient<paths>({
    baseUrl: apiBaseUrl,
    fetch: fetcher,
    credentials: 'include',
  });
  return {
    async listPrimingTokens() {
      const result = await client.GET('/priming/token');
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async createPrimingToken() {
      const result = await client.POST('/priming/token', {});
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async revokePrimingToken(tokenId) {
      const result = await client.DELETE('/priming/token/{tokenId}', {
        params: { path: { tokenId } },
      });
      if (result.response.status === 204) return;
      throw failure(result.response.status, result.error);
    },
  };
}

export const primingApi = createPrimingApi();

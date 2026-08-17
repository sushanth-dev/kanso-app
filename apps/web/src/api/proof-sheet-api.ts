import createClient from 'openapi-fetch';
import type { components, paths } from '../generated/api.ts';
import { apiBaseUrl } from './base-url.ts';
import { failure } from './account-api.ts';

export type ProofSheet = components['schemas']['ProofSheet'];
export type SharedProofSheet = components['schemas']['SharedProofSheet'];

export interface ProofSheetApi {
  listProofSheets(playerId: string): Promise<ProofSheet[]>;
  createProofSheet(playerId: string): Promise<ProofSheet>;
  revokeProofSheet(proofSheetId: string): Promise<void>;
}

export function createProofSheetApi(
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): ProofSheetApi {
  const client = createClient<paths>({
    baseUrl: apiBaseUrl,
    fetch: fetcher,
    credentials: 'include',
  });
  return {
    async listProofSheets(playerId) {
      const result = await client.GET('/players/{playerId}/proof-sheets', {
        params: { path: { playerId } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async createProofSheet(playerId) {
      const result = await client.POST('/players/{playerId}/proof-sheets', {
        params: { path: { playerId } },
        body: {},
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async revokeProofSheet(proofSheetId) {
      const result = await client.DELETE('/proof-sheets/{proofSheetId}', {
        params: { path: { proofSheetId } },
      });
      if (result.response.status === 204) return;
      throw failure(result.response.status, result.error);
    },
  };
}

export const proofSheetApi = createProofSheetApi();

export interface SharedProofSheetApi {
  getShared(token: string): Promise<SharedProofSheet>;
}

/**
 * The public read is credential-free: a forwarded link is opened by someone
 * with no session, so the fetch must not attach the session cookie (the risk
 * the story's security assessment names). `credentials: 'omit'` forces that
 * even on the same origin.
 */
export function createSharedProofSheetApi(
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): SharedProofSheetApi {
  const client = createClient<paths>({
    baseUrl: apiBaseUrl,
    fetch: fetcher,
    credentials: 'omit',
  });
  return {
    async getShared(token) {
      const result = await client.GET('/shared/proof-sheets/{token}', {
        params: { path: { token } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
  };
}

export const sharedProofSheetApi = createSharedProofSheetApi();

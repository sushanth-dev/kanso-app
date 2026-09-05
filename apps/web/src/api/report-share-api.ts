import createClient from 'openapi-fetch';
import type { components, paths } from '../generated/api.ts';
import { apiBaseUrl } from './base-url.ts';
import { failure } from './account-api.ts';

export type ReportCardLink = components['schemas']['ReportCardLink'];
export type SharedReportCard = components['schemas']['SharedReportCard'];

export interface CreateReportShareCardBody {
  stream: 'online' | 'tournament';
  tournamentId?: string;
  expiresAt?: string;
}

export interface ReportShareApi {
  listReportShareCards(): Promise<ReportCardLink[]>;
  createReportShareCard(body: CreateReportShareCardBody): Promise<ReportCardLink>;
  revokeReportShareCard(shareLinkId: string): Promise<void>;
}

export function createReportShareApi(
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): ReportShareApi {
  const client = createClient<paths>({
    baseUrl: apiBaseUrl,
    fetch: fetcher,
    credentials: 'include',
  });
  return {
    async listReportShareCards() {
      const result = await client.GET('/report/share-cards');
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async createReportShareCard(body) {
      const result = await client.POST('/report/share-cards', { body });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async revokeReportShareCard(shareLinkId) {
      const result = await client.DELETE('/report/share-cards/{shareLinkId}', {
        params: { path: { shareLinkId } },
      });
      if (result.response.status === 204) return;
      throw failure(result.response.status, result.error);
    },
  };
}

export const reportShareApi = createReportShareApi();

export interface SharedCardApi {
  getShared(token: string): Promise<SharedReportCard>;
}

/**
 * The public read is credential-free, like the other shared pages: a forwarded
 * link is opened by someone with no session, so the fetch must not attach the
 * session cookie. There is no confirm act - viewing is the whole link.
 */
export function createSharedCardApi(
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): SharedCardApi {
  const read = createClient<paths>({
    baseUrl: apiBaseUrl,
    fetch: fetcher,
    credentials: 'omit',
  });
  return {
    async getShared(token) {
      const result = await read.GET('/shared/cards/{token}', {
        params: { path: { token } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
  };
}

export const sharedCardApi = createSharedCardApi();

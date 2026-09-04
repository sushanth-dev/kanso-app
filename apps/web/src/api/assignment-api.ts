import createClient from 'openapi-fetch';
import type { components, paths } from '../generated/api.ts';
import { apiBaseUrl } from './base-url.ts';
import { failure } from './account-api.ts';

export type AssignmentLink = components['schemas']['AssignmentLink'];
export type SharedAssignment = components['schemas']['SharedAssignment'];

export interface CreateAssignmentLinkBody {
  catalogueKey: string;
  instruction: string;
  expiresAt?: string;
}

export interface AssignmentApi {
  listAssignmentLinks(): Promise<AssignmentLink[]>;
  createAssignmentLink(body: CreateAssignmentLinkBody): Promise<AssignmentLink>;
  revokeAssignmentLink(assignmentId: string): Promise<void>;
}

export function createAssignmentApi(
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): AssignmentApi {
  const client = createClient<paths>({
    baseUrl: apiBaseUrl,
    fetch: fetcher,
    credentials: 'include',
  });
  return {
    async listAssignmentLinks() {
      const result = await client.GET('/assignments');
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async createAssignmentLink(body) {
      const result = await client.POST('/assignments', { body });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async revokeAssignmentLink(assignmentId) {
      const result = await client.DELETE('/assignments/{assignmentId}', {
        params: { path: { assignmentId } },
      });
      if (result.response.status === 204) return;
      throw failure(result.response.status, result.error);
    },
  };
}

export const assignmentApi = createAssignmentApi();

export interface SharedAssignmentApi {
  getShared(token: string): Promise<SharedAssignment>;
  confirm(token: string): Promise<void>;
}

/**
 * The public read is credential-free, like the shared proof sheet: a forwarded
 * link is opened by someone with no session, so the fetch must not attach the
 * session cookie. The confirm is the opposite act - it is the one that needs
 * the player's session, so it sends with credentials.
 */
export function createSharedAssignmentApi(
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): SharedAssignmentApi {
  const read = createClient<paths>({
    baseUrl: apiBaseUrl,
    fetch: fetcher,
    credentials: 'omit',
  });
  const act = createClient<paths>({
    baseUrl: apiBaseUrl,
    fetch: fetcher,
    credentials: 'include',
  });
  return {
    async getShared(token) {
      const result = await read.GET('/shared/assignments/{token}', {
        params: { path: { token } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async confirm(token) {
      const result = await act.POST('/shared/assignments/{token}/confirm', {
        params: { path: { token } },
      });
      if (result.response.status === 204) return;
      throw failure(result.response.status, result.error);
    },
  };
}

export const sharedAssignmentApi = createSharedAssignmentApi();

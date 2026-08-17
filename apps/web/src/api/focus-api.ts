import createClient from 'openapi-fetch';
import type { components, paths } from '../generated/api.ts';
import { apiBaseUrl } from './base-url.ts';
import { failure } from './account-api.ts';

export type FocusCatalogueEntry = components['schemas']['FocusCatalogueEntry'];
export type FocusMeasurement = components['schemas']['FocusMeasurement'];
export type FocusTrend = components['schemas']['FocusTrend'];

// Hand-written rather than re-exported: openapi-typescript renders the
// nullable `catalogue` reference as `FocusCatalogueEntry & (Record<string,
// never> | null)`, which drops the null and mismatches openapi-fetch's
// response type. The contract is `catalogue: FocusCatalogueEntry | null`.
export interface ActiveFocus {
  id: string;
  source: 'recommended' | 'coach' | 'self';
  catalogue: FocusCatalogueEntry | null;
  coachInstruction: string | null;
  unverified: boolean;
  pairedFocusId: string | null;
  startedAt: string;
  measurements: FocusMeasurement[];
}

// The request body is hand-written the same way `StartImportBody` is in
// import-api.ts; the discriminated union mirrors the API's `SetFocus` schema.
export type SetFocus =
  | { source: 'recommended' | 'self'; catalogueKey: string }
  | {
      source: 'coach';
      catalogueKey?: string;
      coachInstruction: string;
      pairedCatalogueKey: string;
    };

export interface FocusApi {
  listFocuses(): Promise<FocusCatalogueEntry[]>;
  getFocus(playerId: string): Promise<ActiveFocus>;
  setFocus(playerId: string, body: SetFocus): Promise<ActiveFocus>;
}

export function createFocusApi(fetcher: typeof globalThis.fetch = globalThis.fetch): FocusApi {
  const client = createClient<paths>({
    baseUrl: apiBaseUrl,
    fetch: fetcher,
    credentials: 'include',
  });
  return {
    async listFocuses() {
      const result = await client.GET('/focuses');
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async getFocus(playerId) {
      const result = await client.GET('/players/{playerId}/focus', {
        params: { path: { playerId } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async setFocus(playerId, body) {
      const result = await client.PUT('/players/{playerId}/focus', {
        params: { path: { playerId } },
        body,
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
  };
}

export const focusApi = createFocusApi();

import createClient from 'openapi-fetch';
import type { components, paths } from '../generated/api.ts';
import { apiBaseUrl } from './base-url.ts';
import { failure } from './account-api.ts';

export type TournamentSummary = components['schemas']['TournamentSummary'];
export type TournamentList = components['schemas']['TournamentList'];
export type TournamentDetail = components['schemas']['TournamentDetail'];
export type TournamentGame = components['schemas']['TournamentGame'];
export type TournamentDecay = components['schemas']['TournamentDecay'];
export type RoundDecay = components['schemas']['RoundDecay'];

export interface TournamentApi {
  listTournaments(): Promise<TournamentList>;
  getTournament(tournamentId: string): Promise<TournamentDetail>;
  getRoundDecay(tournamentId: string): Promise<TournamentDecay>;
}

export function createTournamentApi(
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): TournamentApi {
  const client = createClient<paths>({
    baseUrl: apiBaseUrl,
    fetch: fetcher,
    credentials: 'include',
  });
  return {
    async listTournaments() {
      const result = await client.GET('/tournaments');
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async getTournament(tournamentId) {
      const result = await client.GET('/tournaments/{tournamentId}', {
        params: { path: { tournamentId } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async getRoundDecay(tournamentId) {
      const result = await client.GET('/tournaments/{tournamentId}/round-decay', {
        params: { path: { tournamentId } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
  };
}

export const tournamentApi = createTournamentApi();

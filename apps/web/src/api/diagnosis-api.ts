import createClient from 'openapi-fetch';
import type { components, paths } from '../generated/api.ts';
import { failure } from './account-api.ts';

export type Stream = components['schemas']['Stream'];
export type Report = components['schemas']['Report'];
export type Weakness = components['schemas']['Weakness'];
export type WeaknessKind = components['schemas']['WeaknessKind'];
export type MotifReport = components['schemas']['MotifReport'];
export type PhaseReport = components['schemas']['PhaseReport'];
export type TimeTrouble = components['schemas']['TimeTrouble'];
export type GameList = components['schemas']['GameList'];
export type GameSummary = components['schemas']['GameSummary'];
export type AnalysisStatus = components['schemas']['AnalysisStatus'];

export interface DiagnosisApi {
  getReport(playerId: string, stream: Stream): Promise<Report>;
  getMotifs(playerId: string, stream: Stream): Promise<MotifReport>;
  getPhases(playerId: string, stream: Stream): Promise<PhaseReport>;
  listGames(playerId: string, stream: Stream): Promise<GameList>;
}

export function createDiagnosisApi(
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): DiagnosisApi {
  const client = createClient<paths>({
    baseUrl: window.location.origin,
    fetch: fetcher,
    credentials: 'same-origin',
  });
  return {
    async getReport(playerId, stream) {
      const result = await client.GET('/players/{playerId}/report', {
        params: { path: { playerId }, query: { stream } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async getMotifs(playerId, stream) {
      const result = await client.GET('/players/{playerId}/motifs', {
        params: { path: { playerId }, query: { stream } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async getPhases(playerId, stream) {
      const result = await client.GET('/players/{playerId}/phase', {
        params: { path: { playerId }, query: { stream } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async listGames(playerId, stream) {
      // ponytail: one page (limit 100) is enough to answer "is anything still
      // analyzing"; the report is the source of truth for coverage.
      const result = await client.GET('/players/{playerId}/games', {
        params: { path: { playerId }, query: { stream, limit: 100 } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
  };
}

export const diagnosisApi = createDiagnosisApi();

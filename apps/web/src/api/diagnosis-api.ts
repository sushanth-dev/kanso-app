import createClient from 'openapi-fetch';
import type { components, paths } from '../generated/api.ts';
import { apiBaseUrl } from './base-url.ts';
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
export type GameDetail = components['schemas']['GameDetail'];
export type Mistake = components['schemas']['Mistake'];
export type MovePly = components['schemas']['MovePly'];
export type Evaluation = components['schemas']['Evaluation'];

export interface DiagnosisApi {
  getReport(stream: Stream): Promise<Report>;
  getMotifs(stream: Stream): Promise<MotifReport>;
  getPhases(stream: Stream): Promise<PhaseReport>;
  listGames(stream: Stream): Promise<GameList>;
  getGame(gameId: string): Promise<GameDetail>;
}

export function createDiagnosisApi(
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): DiagnosisApi {
  const client = createClient<paths>({
    baseUrl: apiBaseUrl,
    fetch: fetcher,
    credentials: 'include',
  });
  return {
    async getReport(stream) {
      const result = await client.GET('/report', {
        params: { query: { stream } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async getMotifs(stream) {
      const result = await client.GET('/motifs', {
        params: { query: { stream } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async getPhases(stream) {
      const result = await client.GET('/phase', {
        params: { query: { stream } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async listGames(stream) {
      // ponytail: one page (limit 100) is enough to answer "is anything still
      // analyzing"; the report is the source of truth for coverage.
      const result = await client.GET('/games', {
        params: { query: { stream, limit: 100 } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async getGame(gameId) {
      const result = await client.GET('/games/{gameId}', {
        params: { path: { gameId } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
  };
}

export const diagnosisApi = createDiagnosisApi();

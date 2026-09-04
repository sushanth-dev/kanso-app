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
export type CctScan = components['schemas']['CctScan'];
export type CctMove = components['schemas']['CctMove'];
export type Explanation = components['schemas']['Explanation'];
export type ActionItemDone = components['schemas']['ActionItemDone'];
export type ActionItem = components['schemas']['ActionItem'];
export type PracticeQueue = components['schemas']['PracticeQueue'];
export type PracticeQueueItem = components['schemas']['PracticeQueueItem'];
export type ActionItemList = components['schemas']['ActionItemList'];
export type WeaknessCoaching = components['schemas']['WeaknessCoaching'];
export type SocraticQuestion = components['schemas']['SocraticQuestion'];
export type PracticePuzzleTally = components['schemas']['PracticePuzzleTally'];
export type TransferGap = components['schemas']['TransferGap'];
export type Color = components['schemas']['Color'];
export type PracticeSet = components['schemas']['PracticeSet'];
export type PracticePuzzle = components['schemas']['PracticePuzzle'];
export type PracticeReviews = components['schemas']['PracticeReviews'];
export type PracticeReviewItem = components['schemas']['PracticeReviewItem'];

export interface DiagnosisApi {
  getReport(stream: Stream, tournamentId?: string): Promise<Report>;
  listGames(stream: Stream, tournamentId?: string): Promise<GameList>;
  getGame(gameId: string): Promise<GameDetail>;
  queueAnalysis(gameId: string): Promise<void>;
  getPracticePuzzles(kind: WeaknessKind, group: string): Promise<PracticeSet>;
  recordPracticePuzzle(input: {
    puzzleId: string;
    kind: WeaknessKind;
    group: string;
    solved: boolean;
  }): Promise<PracticePuzzleTally>;
  /** ST-107. Ask the coach to judge one action item's assessment. */
  markActionItemDone(input: { actionItemId: string; summary: string }): Promise<ActionItemDone>;
  /** ST-107. The puzzles page's pending, upcoming, and mastered buckets. */
  getPracticeQueue(): Promise<PracticeQueue>;
  /** ST-124. The practice surface's due-for-review section, cap included. */
  getPracticeReviews(): Promise<PracticeReviews>;
  /** ST-107. Every assigned action item, newest first. */
  listActionItems(): Promise<ActionItemList>;
  /**
   * The click that opens a weakness: writes the model's advice line once,
   * stores it, and assigns the group's three resources when absent.
   */
  coachWeakness(input: { weaknessId: string }): Promise<WeaknessCoaching>;
  deleteGame(gameId: string): Promise<void>;
  setGameColor(gameId: string, playerColor: Color): Promise<GameSummary>;
  getCctScan(mistakeId: string): Promise<CctScan>;
  getExplanation(mistakeId: string): Promise<Explanation>;
  getSocraticQuestion(mistakeId: string): Promise<SocraticQuestion>;
  getTransferGap(refresh?: boolean): Promise<TransferGap>;
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
    async getReport(stream, tournamentId) {
      const result = await client.GET('/report', {
        params: { query: { stream, ...(tournamentId !== undefined ? { tournamentId } : {}) } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async listGames(stream, tournamentId) {
      // ponytail: one page (limit 100) is enough to answer "is anything still
      // analyzing"; the report is the source of truth for coverage.
      const result = await client.GET('/games', {
        params: {
          query: {
            stream,
            limit: 100,
            ...(tournamentId !== undefined ? { tournament: tournamentId } : {}),
          },
        },
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
    async queueAnalysis(gameId) {
      const result = await client.POST('/games/{gameId}/analysis', {
        params: { path: { gameId } },
      });
      if (result.response.status === 202) return;
      throw failure(result.response.status, result.error);
    },
    async getPracticePuzzles(kind, group) {
      const result = await client.GET('/practice/puzzles', {
        params: { query: { kind, group } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async recordPracticePuzzle(input) {
      const result = await client.POST('/practice/puzzles', { body: input });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async markActionItemDone(input) {
      const result = await client.POST('/report/action-items/done', { body: input });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async getPracticeQueue() {
      const result = await client.GET('/practice/queue', {});
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async getPracticeReviews() {
      const result = await client.GET('/practice/reviews', {});
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async listActionItems() {
      const result = await client.GET('/report/action-items', {});
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async coachWeakness(input) {
      const result = await client.POST('/report/weakness', { body: input });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async deleteGame(gameId) {
      const result = await client.DELETE('/games/{gameId}', {
        params: { path: { gameId } },
      });
      if (result.response.status === 204) return;
      throw failure(result.response.status, result.error);
    },
    async setGameColor(gameId, playerColor) {
      const result = await client.PATCH('/games/{gameId}', {
        params: { path: { gameId } },
        body: { playerColor },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async getCctScan(mistakeId) {
      const result = await client.GET('/mistakes/{mistakeId}/cct', {
        params: { path: { mistakeId } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async getExplanation(mistakeId) {
      const result = await client.GET('/mistakes/{mistakeId}/explanation', {
        params: { path: { mistakeId } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async getSocraticQuestion(mistakeId) {
      const result = await client.GET('/mistakes/{mistakeId}/question', {
        params: { path: { mistakeId } },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
    async getTransferGap(refresh = false) {
      const result = await client.GET('/transfer-gap', {
        params: { query: refresh ? { refresh: 'true' } : {} },
      });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
  };
}

export const diagnosisApi = createDiagnosisApi();

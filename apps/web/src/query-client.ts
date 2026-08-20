import { queryOptions, QueryClient } from '@tanstack/react-query';
import { accountApi } from './api/account-api.ts';
import { diagnosisApi, type Stream } from './api/diagnosis-api.ts';
import { focusApi } from './api/focus-api.ts';
import { proofSheetApi } from './api/proof-sheet-api.ts';
export const ME_QUERY_KEY = ['me'] as const;
export const meQueryOptions = () =>
  queryOptions({
    queryKey: ME_QUERY_KEY,
    queryFn: () => accountApi.getMe(),
    retry: false,
    staleTime: 30_000,
  });

export const reportQueryOptions = (playerId: string, stream: Stream) =>
  queryOptions({
    queryKey: ['report', playerId, stream] as const,
    queryFn: () => diagnosisApi.getReport(playerId, stream),
    retry: false,
    staleTime: 30_000,
  });

export const motifsQueryOptions = (playerId: string, stream: Stream) =>
  queryOptions({
    queryKey: ['motifs', playerId, stream] as const,
    queryFn: () => diagnosisApi.getMotifs(playerId, stream),
    retry: false,
    staleTime: 30_000,
  });

export const phasesQueryOptions = (playerId: string, stream: Stream) =>
  queryOptions({
    queryKey: ['phases', playerId, stream] as const,
    queryFn: () => diagnosisApi.getPhases(playerId, stream),
    retry: false,
    staleTime: 30_000,
  });

export const gamesQueryOptions = (playerId: string, stream: Stream) =>
  queryOptions({
    queryKey: ['games', playerId, stream] as const,
    queryFn: () => diagnosisApi.listGames(playerId, stream),
    retry: false,
    staleTime: 30_000,
  });

export const gameQueryOptions = (gameId: string) =>
  queryOptions({
    queryKey: ['game', gameId] as const,
    queryFn: () => diagnosisApi.getGame(gameId),
    retry: false,
    staleTime: 30_000,
  });

export const focusesQueryOptions = () =>
  queryOptions({
    queryKey: ['focuses'] as const,
    queryFn: () => focusApi.listFocuses(),
    retry: false,
    staleTime: 30_000,
  });

export const focusQueryOptions = (playerId: string) =>
  queryOptions({
    queryKey: ['focus', playerId] as const,
    queryFn: () => focusApi.getFocus(playerId),
    retry: false,
    staleTime: 30_000,
  });

export const proofSheetsQueryOptions = (playerId: string) =>
  queryOptions({
    queryKey: ['proof-sheets', playerId] as const,
    queryFn: () => proofSheetApi.listProofSheets(playerId),
    retry: false,
    staleTime: 30_000,
  });

export const queryClient = new QueryClient();

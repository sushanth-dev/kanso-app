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

export const reportQueryOptions = (stream: Stream) =>
  queryOptions({
    queryKey: ['report', stream] as const,
    queryFn: () => diagnosisApi.getReport(stream),
    retry: false,
    staleTime: 30_000,
  });

export const motifsQueryOptions = (stream: Stream) =>
  queryOptions({
    queryKey: ['motifs', stream] as const,
    queryFn: () => diagnosisApi.getMotifs(stream),
    retry: false,
    staleTime: 30_000,
  });

export const phasesQueryOptions = (stream: Stream) =>
  queryOptions({
    queryKey: ['phases', stream] as const,
    queryFn: () => diagnosisApi.getPhases(stream),
    retry: false,
    staleTime: 30_000,
  });

export const gamesQueryOptions = (stream: Stream) =>
  queryOptions({
    queryKey: ['games', stream] as const,
    queryFn: () => diagnosisApi.listGames(stream),
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

export const focusQueryOptions = () =>
  queryOptions({
    queryKey: ['focus'] as const,
    queryFn: () => focusApi.getFocus(),
    retry: false,
    staleTime: 30_000,
  });

export const proofSheetsQueryOptions = () =>
  queryOptions({
    queryKey: ['proof-sheets'] as const,
    queryFn: () => proofSheetApi.listProofSheets(),
    retry: false,
    staleTime: 30_000,
  });

export const queryClient = new QueryClient();

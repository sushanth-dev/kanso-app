import { queryOptions, QueryClient } from '@tanstack/react-query';
import { accountApi, ApiRequestError } from './api/account-api.ts';
import { diagnosisApi, type Stream } from './api/diagnosis-api.ts';
import { focusApi } from './api/focus-api.ts';
import { proofSheetApi } from './api/proof-sheet-api.ts';
import { tournamentApi } from './api/tournament-api.ts';
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

export const cctScanQueryOptions = (mistakeId: string) =>
  queryOptions({
    queryKey: ['cct-scan', mistakeId] as const,
    queryFn: () => diagnosisApi.getCctScan(mistakeId),
    retry: false,
    staleTime: 30_000,
  });

// ADR-0018: a 502 means the model call failed, not that the mistake has no
// explanation. Retry that case a few times; anything else (401/403/404) is final.
const retryOnModelFailure = (failureCount: number, error: unknown) =>
  error instanceof ApiRequestError && error.status === 502 && failureCount < 5;

export const explanationQueryOptions = (mistakeId: string) =>
  queryOptions({
    queryKey: ['explanation', mistakeId] as const,
    queryFn: () => diagnosisApi.getExplanation(mistakeId),
    retry: retryOnModelFailure,
    staleTime: 30_000,
  });

export const socraticQuestionQueryOptions = (mistakeId: string) =>
  queryOptions({
    queryKey: ['socratic-question', mistakeId] as const,
    queryFn: () => diagnosisApi.getSocraticQuestion(mistakeId),
    retry: retryOnModelFailure,
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

export const tournamentsQueryOptions = () =>
  queryOptions({
    queryKey: ['tournaments'] as const,
    queryFn: () => tournamentApi.listTournaments(),
    retry: false,
    staleTime: 30_000,
  });

export const tournamentQueryOptions = (tournamentId: string) =>
  queryOptions({
    queryKey: ['tournament', tournamentId] as const,
    queryFn: () => tournamentApi.getTournament(tournamentId),
    retry: false,
    staleTime: 30_000,
  });

export const roundDecayQueryOptions = (tournamentId: string) =>
  queryOptions({
    queryKey: ['round-decay', tournamentId] as const,
    queryFn: () => tournamentApi.getRoundDecay(tournamentId),
    retry: false,
    staleTime: 30_000,
  });

export const transferGapQueryOptions = () =>
  queryOptions({
    queryKey: ['transfer-gap'] as const,
    queryFn: () => diagnosisApi.getTransferGap(),
    retry: false,
    staleTime: 30_000,
  });

export const queryClient = new QueryClient();

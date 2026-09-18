import { queryOptions, QueryClient } from '@tanstack/react-query';
import { accountApi, ApiRequestError } from './api/account-api.ts';
import { diagnosisApi, type Stream, type WeaknessKind } from './api/diagnosis-api.ts';
import { focusApi } from './api/focus-api.ts';
import { assignmentApi } from './api/assignment-api.ts';
import { gameShareApi } from './api/game-share-api.ts';
import { reportShareApi } from './api/report-share-api.ts';
import { primingApi } from './api/priming-api.ts';
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

/**
 * ST-164. Whether anybody is signed in, asked in a way that cannot answer 401.
 *
 * The shell and the landing page read only this. Everything that needs the
 * account itself still asks `meQueryOptions`, which holds the 401 that the two
 * route guards read as the redirect signal.
 */
export const SESSION_QUERY_KEY = ['session'] as const;
export const sessionQueryOptions = () =>
  queryOptions({
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => accountApi.getSession(),
    retry: false,
    staleTime: 30_000,
  });

/**
 * Both keys hold session truth, so signing in, signing out, and deleting an
 * account have to clear both. Ten call sites cleared one of them by hand before
 * this existed, which is how the two would have drifted apart.
 *
 * They are cleared differently because the two reads are not alike. `/me`
 * answers 401 once the session is gone, so it is removed and left alone until a
 * route guard asks again. `/session` answers 200 either way, so it is
 * invalidated instead: a reader that is already mounted, which the shell is
 * during the sign-out navigation, keeps the result it last rendered when its
 * query is removed and never re-reads it.
 */
export function clearSessionState(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
}

export const reportQueryOptions = (stream: Stream, tournamentId?: string) =>
  queryOptions({
    queryKey: ['report', stream, tournamentId ?? null] as const,
    queryFn: () => diagnosisApi.getReport(stream, tournamentId),
    retry: false,
    staleTime: 30_000,
  });

/** ST-106. One weakness group's drill set; refetch deals a fresh set. */
export const practiceQueryOptions = (kind: WeaknessKind, group: string, stream: Stream) =>
  queryOptions({
    queryKey: ['practice', kind, group, stream] as const,
    queryFn: () => diagnosisApi.getPracticePuzzles(kind, group, stream),
    retry: false,
    staleTime: 0,
  });

/** ST-107. The puzzles page's pending, upcoming, and mastered buckets. */
export const practiceQueueQueryOptions = () =>
  queryOptions({
    queryKey: ['practice-queue'] as const,
    queryFn: () => diagnosisApi.getPracticeQueue(),
    retry: false,
  });

/** ST-150. The player's weakness groups and their verified-retirement state. */
export const patternsQueryOptions = (stream: Stream) =>
  queryOptions({
    queryKey: ['patterns', stream] as const,
    queryFn: () => diagnosisApi.getPatterns(stream),
    retry: false,
    staleTime: 30_000,
  });

/** ST-124. The due-for-review section the practice surface shows. */
export const practiceReviewsQueryOptions = () =>
  queryOptions({
    queryKey: ['practice-reviews'] as const,
    queryFn: () => diagnosisApi.getPracticeReviews(),
    retry: false,
  });

/** ST-107. The curriculum page's list of every assigned action item. */
export const actionItemsQueryOptions = () =>
  queryOptions({
    queryKey: ['action-items'] as const,
    queryFn: () => diagnosisApi.listActionItems(),
    retry: false,
  });

export const gamesQueryOptions = (stream: Stream, tournamentId?: string) =>
  queryOptions({
    queryKey: ['games', stream, tournamentId ?? null] as const,
    queryFn: () => diagnosisApi.listGames(stream, tournamentId),
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

/** ST-117. The focus surface's live assignment links. */
export const assignmentsQueryOptions = () =>
  queryOptions({
    queryKey: ['assignments'] as const,
    queryFn: () => assignmentApi.listAssignmentLinks(),
    retry: false,
    staleTime: 30_000,
  });

/** ST-118. One reviewed game's live share links, on the review page. */
export const gameShareLinksQueryOptions = (gameId: string) =>
  queryOptions({
    queryKey: ['game-share-links', gameId] as const,
    queryFn: () => gameShareApi.listGameShareLinks(gameId),
    retry: false,
    staleTime: 30_000,
  });

/** ST-127. The player's live report share cards, on the report page. */
export const reportShareCardsQueryOptions = () =>
  queryOptions({
    queryKey: ['report-share-cards'] as const,
    queryFn: () => reportShareApi.listReportShareCards(),
    retry: false,
    staleTime: 30_000,
  });

/** ST-153. The live priming token, on the settings page. */
export const primingTokenQueryOptions = () =>
  queryOptions({
    queryKey: ['priming-tokens'] as const,
    queryFn: () => primingApi.listPrimingTokens(),
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

export const transferGapSeriesQueryOptions = () =>
  queryOptions({
    queryKey: ['transfer-gap-series'] as const,
    queryFn: () => diagnosisApi.getTransferGapSeries(),
    retry: false,
    staleTime: 30_000,
  });

export const queryClient = new QueryClient();

import { useEffect, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { MIN_REPORT_GAMES, isActiveGame } from '../analysis-status.ts';
import { ApiRequestError } from '../api/account-api.ts';
import {
  diagnosisApi,
  type GameSummary,
  type Report,
  type Stream,
  type Weakness,
  type WeaknessKind,
} from '../api/diagnosis-api.ts';
import { StreamToggle } from '../components/stream-toggle.tsx';
import { gamesQueryOptions, reportQueryOptions, tournamentsQueryOptions } from '../query-client.ts';
import { ReportShareCardsSection } from '../components/report-share-cards-section.tsx';
import { TournamentCard } from './tournaments-route.tsx';
import { track } from '../analytics.ts';

const STREAM_HEADING: Record<Stream, string> = {
  tournament: 'Tournament report',
  online: 'Online report',
};

const KIND_LABEL: Record<WeaknessKind, string> = {
  opening: 'Opening',
  motif: 'Tactical motif',
  phase: 'Game phase',
  time_trouble: 'Time trouble',
};

const PRACTICED_THRESHOLD = 20;

const TIME_TROUBLE_UNAVAILABLE: Record<'no_clock_data' | 'not_enough_evidence', string> = {
  no_clock_data: 'No clock data on these games, so time usage is not measured.',
  not_enough_evidence: 'Too few games with clock data to measure time usage.',
};

const generatedAtFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export interface ReportScreenProps {
  stream: Stream;
  report: Report;
  onStreamChange: (stream: Stream) => void;
  analyzingGames?: GameSummary[];
  /** ST-098. A scoped report headings itself with the tournament's name. */
  title?: string;
}

function ReportHeader({
  stream,
  onStreamChange,
  meta,
  title,
}: {
  stream: Stream;
  onStreamChange: (stream: Stream) => void;
  meta?: string;
  title?: string;
}) {
  return (
    <header className="space-y-4">
      <Heading level={1}>{title ?? STREAM_HEADING[stream]}</Heading>
      <StreamToggle stream={stream} onChange={onStreamChange} ariaLabel="Report stream" />
      {meta !== undefined ? (
        <Text as="p" display="block" type="supporting" className="text-sm">
          {meta}
        </Text>
      ) : null}
    </header>
  );
}

export function ReportScreen({
  stream,
  report,
  onStreamChange,
  analyzingGames = [],
  title,
}: ReportScreenProps) {
  const isEmpty = report.weaknesses.length === 0;
  const meta = `Reported ${generatedAtFormatter.format(new Date(report.generatedAt))} covering ${report.gamesCovered} games.`;
  return (
    <div className="space-y-6">
      <ReportHeader stream={stream} onStreamChange={onStreamChange} meta={meta} title={title} />
      {analyzingGames.length > 0 ? <AnalyzingBanner games={analyzingGames} /> : null}
      {report.timeTroubleFromMove !== null ? (
        <Text as="p" display="block" className="text-sm">
          Time trouble starts around move{' '}
          <span className="font-mono">{report.timeTroubleFromMove}</span>.
        </Text>
      ) : (
        <Text as="p" display="block" type="supporting" className="text-sm">
          {TIME_TROUBLE_UNAVAILABLE[report.timeTroubleReason ?? 'no_clock_data']}
        </Text>
      )}
      {report.narrative !== null ? (
        <Card className="space-y-1 p-4">
          <Text type="supporting" className="font-ui text-xs">
            what to do
          </Text>
          <Text as="p" display="block" className="text-primary">
            {report.narrative}
          </Text>
        </Card>
      ) : null}
      {isEmpty ? (
        <EmptyReport report={report} />
      ) : (
        <WeaknessList
          weaknesses={report.weaknesses}
          stream={report.stream}
          tournamentId={report.tournamentId}
        />
      )}
      {!isEmpty ? (
        <ReportShareCardsSection stream={report.stream} tournamentId={report.tournamentId} />
      ) : null}
    </div>
  );
}

interface WeaknessListProps {
  weaknesses: Weakness[];
  stream: Stream;
  /** The report's scope: the cache patch below writes the same key the query reads. */
  tournamentId?: string | null;
}

function WeaknessList({ weaknesses, stream, tournamentId }: WeaknessListProps) {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // The weaknesses whose coaching answer has landed. The endpoint is
  // idempotent - a stored line costs no model call - so this only saves a
  // re-open from refetching.
  const [coached, setCoached] = useState<Set<string>>(() => new Set());
  const [coachingId, setCoachingId] = useState<string | null>(null);
  const onToggle = (id: string) => {
    const next = expandedId === id ? null : id;
    setExpandedId(next);
    if (next === null || coached.has(id)) return;
    setCoachingId(id);
    diagnosisApi
      .coachWeakness({ weaknessId: id })
      .then((coaching) => {
        setCoached((seen) => new Set(seen).add(id));
        // A null line keeps the template copy the report read served.
        queryClient.setQueryData<Report>(['report', stream, tournamentId ?? null], (old) =>
          old === undefined
            ? old
            : {
                ...old,
                weaknesses: old.weaknesses.map((w) =>
                  w.id === id
                    ? {
                        ...w,
                        advice: coaching.advice ?? w.advice,
                        actionItems: coaching.actionItems,
                      }
                    : w,
                ),
              },
        );
      })
      .catch(() => {
        // The template copy stands; opening the weakness again retries.
      })
      .finally(() => setCoachingId((current) => (current === id ? null : current)));
  };
  return (
    <ol className="stagger-in space-y-4">
      {weaknesses.map((weakness) => {
        const expanded = expandedId === weakness.id;
        // ST-106. The group's drill progress replaces the per-instance
        // practiced ticks the replay practice fed: one full deal of 20
        // solved drills earns the badge - and names the next deal.
        const practiced = weakness.drilled >= PRACTICED_THRESHOLD;
        return (
          <li key={weakness.id}>
            <Card>
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <Text type="supporting" className="font-mono text-sm">
                      #{weakness.rank}
                    </Text>
                    <Text className="font-display text-base">{weakness.label}</Text>
                  </div>
                  <Text className="font-mono text-base">
                    {weakness.saturated ? `at least ${weakness.ratingLeak}` : weakness.ratingLeak}
                  </Text>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge label={KIND_LABEL[weakness.kind]} variant="neutral" />
                  {practiced ? <Badge label="Practiced" variant="neutral" /> : null}
                  {weakness.eco !== null ? (
                    <Text type="supporting" className="font-mono text-sm">
                      {weakness.eco}
                    </Text>
                  ) : null}
                </div>
                <dl className="flex flex-wrap gap-x-6 gap-y-2">
                  <div>
                    <dt className="font-ui text-xs text-muted">games</dt>
                    <dd className="font-mono">{weakness.gamesAffected}</dd>
                  </div>
                  <div>
                    <dt className="font-ui text-xs text-muted">occurrences</dt>
                    <dd className="font-mono">{weakness.occurrences}</dd>
                  </div>
                  <div>
                    <dt className="font-ui text-xs text-muted">half-points lost</dt>
                    <dd className="font-mono">{weakness.halfPointsLost}</dd>
                  </div>
                </dl>
                {weakness.lineConsistency !== null ? (
                  <LineConsistencyNote lineConsistency={weakness.lineConsistency} />
                ) : null}
                {weakness.groupKey !== null ? (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    {/* The click materializes the coaching: the model's line
                        for the mistake, or just the resources for an opening. */}
                    {weakness.kind === 'opening' && weakness.actionItems.length === 0 ? (
                      <Link onClick={() => onToggle(weakness.id)} aria-expanded={expanded}>
                        {coachingId === weakness.id ? 'Writing your resources...' : 'Get resources'}
                      </Link>
                    ) : null}
                    {weakness.kind !== 'opening' ? (
                      <Link onClick={() => onToggle(weakness.id)} aria-expanded={expanded}>
                        {expanded ? 'Hide evidence' : 'Show evidence'}
                      </Link>
                    ) : null}
                    {/* ST-111. The report names the weakness; the curriculum
                        page owns the resources, their assessments, and their
                        state. */}
                    {weakness.actionItems.length > 0 ? (
                      <Link href="/curriculum">View curriculum</Link>
                    ) : null}
                    {/* ST-106. The card's one entry: the group's 20-puzzle deal,
                        renamed once the first batch is done. */}
                    <Link
                      href={`/practice?kind=${weakness.kind}&group=${encodeURIComponent(weakness.groupKey)}&label=${encodeURIComponent(weakness.label)}&stream=${stream}`}
                    >
                      {practiced ? 'Practice more puzzles' : 'Practice puzzles'}
                    </Link>
                  </div>
                ) : null}
                {coachingId === weakness.id && weakness.kind !== 'opening' ? (
                  <Text type="supporting" className="font-ui text-xs">
                    The coach is writing your note...
                  </Text>
                ) : null}
              </div>
              {expanded && weakness.kind !== 'opening' ? (
                <EvidenceDetail weakness={weakness} />
              ) : null}
            </Card>
          </li>
        );
      })}
    </ol>
  );
}
/**
 * ST-123. The line-following share beside the opening's other figures, and
 * the honest withholdings: under the five-game floor the refusal names the
 * floor, and no full line means nothing to compare against. The server sends
 * null on an online report, where the figure does not apply.
 */
function LineConsistencyNote({
  lineConsistency,
}: {
  lineConsistency: NonNullable<Weakness['lineConsistency']>;
}) {
  if (lineConsistency.status === 'ok') {
    const percent = Math.round((lineConsistency.matched / lineConsistency.games) * 100);
    return (
      <Text as="p" display="block" type="supporting" className="text-sm">
        You followed your most-played opening line (first ten plies) in{' '}
        <span className="font-mono">
          {lineConsistency.matched} of {lineConsistency.games}
        </span>{' '}
        games - <span className="font-mono">{percent}%</span>.
      </Text>
    );
  }
  if (lineConsistency.status === 'below_floor') {
    return (
      <Text as="p" display="block" type="supporting" className="text-sm">
        Only {lineConsistency.games} {lineConsistency.games === 1 ? 'game' : 'games'} in this
        opening - a consistency number needs at least five.
      </Text>
    );
  }
  return (
    <Text as="p" display="block" type="supporting" className="text-sm">
      No game in this opening reaches ten plies, so there is no full line to compare yet.
    </Text>
  );
}

/**
 * ST-098. The places behind the figure: the advice for this kind of weakness,
 * then the worst positions, each naming the move played, the move the engine
 * wanted, and a link into the game itself.
 */
function EvidenceDetail({ weakness }: { weakness: Weakness }) {
  return (
    <div className="mt-3 space-y-3 text-sm">
      {weakness.advice !== null ? (
        <Text as="p" display="block" className="text-primary">
          {weakness.advice}
        </Text>
      ) : null}
      {weakness.evidence.length > 0 ? (
        <ol className="list-decimal space-y-2 pl-5">
          {weakness.evidence.map((instance) => (
            <li key={`${instance.gameId}-${instance.moveNumber}`}>
              <Text as="span">
                Move <span className="font-mono">{instance.moveNumber}</span> - {instance.moveSan};{' '}
                {instance.bestMoveSan} was better ({instance.judgement},{' '}
                <span className="font-mono">{instance.cpLoss}</span> cp lost)
              </Text>{' '}
              {/* ST-100. The ply lands the board on the flagged position. */}
              <Link href={`/games/${instance.gameId}?ply=${instance.ply}`}>Review game</Link>
            </li>
          ))}
        </ol>
      ) : (
        <Text as="p" display="block" type="supporting">
          No individual positions to show yet.
        </Text>
      )}
    </div>
  );
}

function EmptyReport({ report }: { report: Report }) {
  return (
    <EmptyState
      title="Not enough evidence to rank yet"
      description={`We could not identify a defensible weakness from your ${report.gamesCovered} games. More games will make the diagnosis reliable.`}
      headingLevel={2}
    />
  );
}

function AnalyzingBanner({ games }: { games: GameSummary[] }) {
  return (
    <div
      role="status"
      aria-label="Analyzing games"
      className="flex items-start gap-3 rounded-surface border border-border-strong bg-raised px-4 py-3"
    >
      <Spinner size="sm" />
      <div className="space-y-1">
        <Text as="p" display="block" className="text-sm text-primary">
          Analyzing {games.length} {games.length === 1 ? 'game' : 'games'}:
        </Text>
        <AnalyzingList games={games} />
      </div>
    </div>
  );
}

/**
 * ST-098. The running games as a numbered list. ST-093 capped the inline name
 * run at three because every re-wrap read as a flicker; a list grows downward
 * without reflowing the block around it.
 */
function AnalyzingList({ games }: { games: GameSummary[] }) {
  return (
    <ol className="glass-raised inline-block rounded-surface px-4 py-3 text-left list-decimal space-y-0.5 pl-5">
      {games.map((game) => (
        <li key={game.id} className="text-sm text-primary">
          {game.whiteName ?? 'White'} vs {game.blackName ?? 'Black'}
        </li>
      ))}
    </ol>
  );
}

function Analysing({
  games,
  needsSideCount = 0,
}: {
  games: GameSummary[];
  needsSideCount?: number;
}) {
  const total = games.length;
  const analysed = games.filter(
    (game) => game.analysisStatus === 'complete' || game.analysisStatus === 'failed',
  ).length;
  const active = games.filter(
    (game) =>
      game.analysisStatus === 'queued' ||
      game.analysisStatus === 'analyzing' ||
      (game.analysisStatus === 'pending' && game.playerColor !== null),
  );
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <Spinner size="md" />
      <Text as="p" display="block" className="text-primary">
        {analysed} of {total} {total === 1 ? 'game' : 'games'} analysed
      </Text>
      {active.length > 0 ? <AnalyzingList games={active} /> : null}
      {needsSideCount > 0 ? (
        // ST-095: these games are not analysing and never will on their own;
        // naming a side on the game review page is what starts them.
        <Text as="p" display="block" type="supporting" className="text-sm">
          {needsSideCount} {needsSideCount === 1 ? 'game needs' : 'games need'} your side before
          analysis can start. Open it under Games and pick the colour you played.
        </Text>
      ) : null}
      <Text as="p" display="block" type="supporting" className="text-sm">
        This report will appear as soon as it is ready.
      </Text>
    </div>
  );
}

function NotReady() {
  return (
    <EmptyState
      title="No analyzed games in this stream yet"
      description="Import your games to get a ranked report. Tournament and online games are reported separately."
      headingLevel={2}
      actions={<Link href="/import">Import games</Link>}
    />
  );
}

/** ST-095. Games imported, but the import could not tell which side was yours. */
function NeedsSide({ count }: { count: number }) {
  return (
    <EmptyState
      title={`${count} ${count === 1 ? 'game needs' : 'games need'} your side before analysis`}
      description="The import could not tell which colour you were in these games. Open each one under Games and pick the side you played; analysis starts as soon as you do."
      headingLevel={2}
      actions={<Link href="/games">Open Games</Link>}
    />
  );
}

/** ST-095. Analysed games exist, but too few rated ones for a report. */
function NotEnoughRatedGames({ message }: { message: string }) {
  return (
    <EmptyState
      title="Not enough rated games for a report yet"
      description={message}
      headingLevel={2}
      actions={<Link href="/import">Import games</Link>}
    />
  );
}

function ReportError() {
  return (
    <EmptyState
      title="The report could not be loaded"
      description="Try again, or go back to your account."
      headingLevel={2}
    />
  );
}

function ReportSkeleton() {
  return (
    <div role="status" aria-label="Loading report" aria-busy="true" className="space-y-4">
      <div className="h-8 w-48 rounded-control bg-sunken" />
      <div className="h-4 w-72 rounded-control bg-sunken" />
      <div className="h-32 rounded-surface bg-sunken" />
      <div className="h-32 rounded-surface bg-sunken" />
    </div>
  );
}

/**
 * ST-098. The tournament stream without a tournament picked: a directory. One
 * card per tournament, each gated on its own count (ST-096), each opening that
 * tournament's own report. The blended weakness list is gone from this page -
 * a tournament's diagnosis belongs to the tournament, and online games, which
 * have no tournaments, keep their stream report.
 */
function TournamentDirectory({ onStreamChange }: { onStreamChange: (stream: Stream) => void }) {
  const queryClient = useQueryClient();
  const tournamentsQuery = useQuery(tournamentsQueryOptions());
  const gamesQuery = useQuery({
    ...gamesQueryOptions('tournament'),
    refetchInterval: (query) =>
      query.state.data !== undefined && query.state.data.games.some(isActiveGame) ? 5000 : false,
  });
  // The other stream warms while this one shows, so the toggle lands on data.
  useEffect(() => {
    void queryClient.prefetchQuery(gamesQueryOptions('online'));
    void queryClient.prefetchQuery(reportQueryOptions('online'));
  }, [queryClient]);

  const games = gamesQuery.data?.games ?? [];
  const analyzingGames = games.filter(isActiveGame);
  const needsSideCount = games.filter(
    (game) => game.analysisStatus === 'pending' && game.playerColor === null,
  ).length;
  const tournaments = tournamentsQuery.data?.tournaments ?? [];

  return (
    <div className="space-y-6">
      <ReportHeader stream="tournament" onStreamChange={onStreamChange} />
      {tournamentsQuery.isPending ? (
        <ReportSkeleton />
      ) : tournaments.length > 0 ? (
        <ul className="space-y-3">
          {tournaments.map((summary) => (
            <li key={summary.id}>
              <TournamentCard
                summary={summary}
                disabledReason={
                  summary.gameCount < MIN_REPORT_GAMES
                    ? `A report needs ${MIN_REPORT_GAMES} games; this tournament has ${summary.gameCount}.`
                    : undefined
                }
                actionHref={`/report?stream=tournament&tournamentId=${summary.id}`}
                actionLabel="Open report"
              />
            </li>
          ))}
        </ul>
      ) : (
        <NotReady />
      )}
      {analyzingGames.length > 0 ? <AnalyzingBanner games={analyzingGames} /> : null}
      {needsSideCount > 0 ? <NeedsSide count={needsSideCount} /> : null}
    </div>
  );
}

/** One stream's or one tournament's report. */
export function ScopedReportRoute({
  stream,
  tournamentId,
  gameIds,
  onStreamChange,
}: {
  stream: Stream;
  tournamentId: string | undefined;
  gameIds: string[] | undefined;
  onStreamChange: (stream: Stream) => void;
}) {
  const queryClient = useQueryClient();
  const tournamentsQuery = useQuery({
    ...tournamentsQueryOptions(),
    enabled: stream === 'tournament' && tournamentId !== undefined,
  });
  const gamesQuery = useQuery({
    ...gamesQueryOptions(stream, tournamentId),
    refetchInterval: (query) =>
      query.state.data !== undefined && query.state.data.games.some(isActiveGame) ? 5000 : false,
  });
  // ST-093: when the import handed us its own game ids, the analysing counter
  // counts only that batch; every other use of the games list stays in scope.
  const batchIdSet = new Set(gameIds ?? []);
  const batchGames =
    gameIds !== undefined && gameIds.length > 0
      ? (gamesQuery.data?.games ?? []).filter((game) => batchIdSet.has(game.id))
      : (gamesQuery.data?.games ?? []);
  const analyzingGames = (gamesQuery.data?.games ?? []).filter(isActiveGame);
  // ST-095: imported games whose side the import could not decide. They sit
  // `pending` until the player names a colour on the game review page, and no
  // amount of polling moves them.
  const needsSideCount = (gamesQuery.data?.games ?? []).filter(
    (game) => game.analysisStatus === 'pending' && game.playerColor === null,
  ).length;

  const reportQuery = useQuery({
    ...reportQueryOptions(stream, tournamentId),
    refetchInterval: analyzingGames.length > 0 ? 5000 : false,
  });
  // ST-097. The other stream's queries warm while this one shows, so the
  // toggle lands on data instead of a skeleton. With `retry: false` the
  // prefetch of a not-ready stream caches its honest refusal, not a retry
  // loop.
  useEffect(() => {
    const other: Stream = stream === 'tournament' ? 'online' : 'tournament';
    void queryClient.prefetchQuery(gamesQueryOptions(other));
    void queryClient.prefetchQuery(reportQueryOptions(other));
  }, [stream, queryClient]);
  useEffect(() => {
    if (reportQuery.data !== undefined) track('report_viewed', { stream });
  }, [reportQuery.data, stream]);

  const title =
    stream === 'tournament' && tournamentId !== undefined
      ? (tournamentsQuery.data?.tournaments.find((t) => t.id === tournamentId)?.name ??
        STREAM_HEADING.tournament)
      : STREAM_HEADING[stream];

  // A report exists: show it, plus a compact banner for any game still
  // analysing. Never swap the whole page to an "analysing" screen, which hid
  // the report and flickered as polling progressed.
  if (reportQuery.data !== undefined) {
    return (
      <ReportScreen
        stream={stream}
        title={title}
        report={reportQuery.data}
        onStreamChange={onStreamChange}
        analyzingGames={analyzingGames}
      />
    );
  }

  // No report yet. The endpoint answers 404 when the scope has no analysed
  // games and 422 (ST-095) when it has analysed games but too few rated ones
  // for a report; each gets its own honest empty state.
  const notReadyError =
    reportQuery.isError && reportQuery.error instanceof ApiRequestError
      ? reportQuery.error.status === 404 || reportQuery.error.status === 422
        ? reportQuery.error
        : null
      : null;

  return (
    <div className="space-y-6">
      <ReportHeader stream={stream} onStreamChange={onStreamChange} title={title} />
      {reportQuery.isPending ? (
        <ReportSkeleton />
      ) : notReadyError !== null ? (
        gamesQuery.isPending ? (
          <ReportSkeleton />
        ) : // ST-096. A running batch renders the analysing screen whatever the
        // report endpoint refused with: the moment one game completes, a
        // thin scope answers 422, and the refusal must not preempt games
        // that are still queued or running. The refusal states arrive only
        // once nothing is active.
        analyzingGames.length > 0 ? (
          <Analysing games={batchGames} needsSideCount={needsSideCount} />
        ) : notReadyError.status === 422 ? (
          <NotEnoughRatedGames message={notReadyError.message} />
        ) : needsSideCount > 0 ? (
          <NeedsSide count={needsSideCount} />
        ) : (
          <NotReady />
        )
      ) : (
        <ReportError />
      )}
    </div>
  );
}

export function ReportRoute() {
  const navigate = useNavigate();
  const { stream, gameIds, tournamentId } = useSearch({ from: '/account/report' });

  const onStreamChange = (next: Stream) => {
    // A stream switch leaves the upload's scope behind: the ids and the
    // tournament belong to the surface that surfaced them.
    void navigate({ to: '/report', search: { stream: next } });
  };

  if (stream === 'tournament' && tournamentId === undefined) {
    return <TournamentDirectory onStreamChange={onStreamChange} />;
  }
  return (
    <ScopedReportRoute
      stream={stream}
      tournamentId={tournamentId}
      gameIds={gameIds}
      onStreamChange={onStreamChange}
    />
  );
}

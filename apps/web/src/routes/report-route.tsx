import { useEffect, useState, type ReactNode } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { MIN_REPORT_GAMES, isActiveGame } from '../analysis-status.ts';
import { ApiRequestError } from '../api/account-api.ts';
import type {
  GameSummary,
  MotifReport,
  PhaseReport,
  Report,
  Stream,
  Weakness,
  WeaknessKind,
} from '../api/diagnosis-api.ts';
import { StreamToggle } from '../components/stream-toggle.tsx';
import { ParticleReveal } from '../components/canvas-ui/ParticleReveal.tsx';
import {
  gamesQueryOptions,
  motifsQueryOptions,
  phasesQueryOptions,
  reportQueryOptions,
  tournamentsQueryOptions,
} from '../query-client.ts';
import { TournamentCard } from './tournaments-route.tsx';
import { track } from '../analytics.ts';

const STREAM_HEADING: Record<Stream, string> = {
  tournament: 'Tournament report',
  online: 'Online report',
};

const KIND_LABEL: Record<WeaknessKind, string> = {
  opening: 'Opening',
  motif: 'Tactical motif',
  phase: 'Phase',
  time_trouble: 'Time trouble',
};

const MOTIF_LABEL: Record<MotifReport['motifs'][number]['motif'], string> = {
  hanging_piece: 'Hanging pieces',
  missed_check: 'Missed checks',
  missed_capture: 'Missed captures',
  missed_threat: 'Missed threats',
};

const PHASE_LABEL: Record<NonNullable<PhaseReport['phases'][number]['phase']>, string> = {
  opening: 'Opening',
  middlegame: 'Middlegame',
  endgame: 'Endgame',
};

const TIME_TROUBLE_UNAVAILABLE: Record<
  Extract<PhaseReport['timeTrouble'], { status: 'unavailable' }>['reason'],
  string
> = {
  no_clock_data: 'These games do not carry clock data.',
  not_enough_evidence: 'Not enough clocked games to measure time trouble yet.',
};

const generatedAtFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const rateFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 0,
});

export interface ReportScreenProps {
  stream: Stream;
  report: Report;
  onStreamChange: (stream: Stream) => void;
  analyzingGames?: GameSummary[];
  /** ST-096. The tournament-stream report page shows the tournament card between the header and the report body. */
  tournamentCard?: ReactNode;
}

function ReportHeader({
  stream,
  onStreamChange,
  meta,
}: {
  stream: Stream;
  onStreamChange: (stream: Stream) => void;
  meta?: string;
}) {
  return (
    <header className="space-y-4">
      <Heading level={1}>{STREAM_HEADING[stream]}</Heading>
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
  tournamentCard = undefined,
}: ReportScreenProps) {
  const isEmpty = report.weaknesses.length === 0;
  const meta = `Reported ${generatedAtFormatter.format(new Date(report.generatedAt))} covering ${report.gamesCovered} games.`;
  return (
    <div className="space-y-6">
      <ReportHeader stream={stream} onStreamChange={onStreamChange} meta={meta} />
      {tournamentCard}
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
      {isEmpty ? (
        <EmptyReport report={report} />
      ) : (
        <WeaknessList weaknesses={report.weaknesses} stream={stream} />
      )}
    </div>
  );
}

interface WeaknessListProps {
  weaknesses: Weakness[];
  stream: Stream;
}

function WeaknessList({ weaknesses, stream }: WeaknessListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const onToggle = (id: string) => setExpandedId((current) => (current === id ? null : id));

  return (
    <ol className="stagger-in space-y-4">
      {weaknesses.map((weakness) => {
        const expanded = expandedId === weakness.id;
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
                  {weakness.rank === 1 ? (
                    <ParticleReveal background="#f7f2ea" className="max-w-fit">
                      <Text className="font-mono text-base">
                        {weakness.saturated
                          ? `at least ${weakness.ratingLeak}`
                          : weakness.ratingLeak}
                      </Text>
                    </ParticleReveal>
                  ) : (
                    <Text className="font-mono text-base">
                      {weakness.saturated ? `at least ${weakness.ratingLeak}` : weakness.ratingLeak}
                    </Text>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge label={KIND_LABEL[weakness.kind]} variant="neutral" />
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
                {weakness.kind !== 'opening' ? (
                  <Link onClick={() => onToggle(weakness.id)} aria-expanded={expanded}>
                    {expanded ? 'Hide evidence' : 'Show evidence'}
                  </Link>
                ) : null}
              </div>
              {expanded && weakness.kind !== 'opening' ? (
                <AggregateDetail kind={weakness.kind} stream={stream} />
              ) : null}
            </Card>
          </li>
        );
      })}
    </ol>
  );
}

function AggregateDetail({
  kind,
  stream,
}: {
  kind: Exclude<WeaknessKind, 'opening'>;
  stream: Stream;
}) {
  return kind === 'motif' ? (
    <MotifAggregate stream={stream} />
  ) : (
    <PhaseAggregate kind={kind} stream={stream} />
  );
}

function AggregateSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mt-3 space-y-2">
      <div className="h-4 w-48 rounded-control bg-sunken" />
      <div className="h-4 w-64 rounded-control bg-sunken" />
    </div>
  );
}

function AggregateError() {
  return (
    <Text as="p" display="block" type="supporting" className="mt-3 text-sm">
      This breakdown could not be loaded right now.
    </Text>
  );
}

function MotifAggregate({ stream }: { stream: Stream }) {
  const { data, isPending, isError } = useQuery(motifsQueryOptions(stream));
  if (isPending) return <AggregateSkeleton />;
  if (isError || data === undefined) return <AggregateError />;
  return <MotifBreakdown report={data} />;
}

function PhaseAggregate({ kind, stream }: { kind: 'phase' | 'time_trouble'; stream: Stream }) {
  const { data, isPending, isError } = useQuery(phasesQueryOptions(stream));
  if (isPending) return <AggregateSkeleton />;
  if (isError || data === undefined) return <AggregateError />;
  return <PhaseBreakdown report={data} timeTroubleOnly={kind === 'time_trouble'} />;
}

function MotifBreakdown({ report }: { report: MotifReport }) {
  return (
    <div className="mt-3 space-y-2 text-sm">
      {report.motifs.map((point) => (
        <div key={point.motif} className="flex items-baseline justify-between gap-3">
          <span>{MOTIF_LABEL[point.motif]}</span>
          <Text type="supporting" className="font-mono">
            {point.positions} positions, {point.totalCpLoss} cp lost
          </Text>
        </div>
      ))}
      <Text as="p" display="block" type="supporting">
        {report.mistakeCount} mistakes counted.
        {report.withheld > 0
          ? ` ${report.withheld} positions held below the reporting threshold.`
          : ''}
        {report.unattributed > 0
          ? ` ${report.unattributed} positions not tied to a known motif.`
          : ''}
      </Text>
    </div>
  );
}

function PhaseBreakdown({
  report,
  timeTroubleOnly,
}: {
  report: PhaseReport;
  timeTroubleOnly: boolean;
}) {
  if (timeTroubleOnly) {
    const trouble = report.timeTrouble;
    if (trouble.status === 'unavailable') {
      return (
        <Text as="p" display="block" type="supporting" className="mt-3 text-sm">
          {TIME_TROUBLE_UNAVAILABLE[trouble.reason]}
        </Text>
      );
    }
    return (
      <div className="mt-3 space-y-1 text-sm">
        <Text as="p" display="block">
          Time trouble starts around move {trouble.fromMove}.
        </Text>
        <Text as="p" display="block">
          <span className="font-mono">{rateFormatter.format(trouble.troubleMistakeRate)}</span> of
          time-trouble moves were mistakes, versus{' '}
          <span className="font-mono">{rateFormatter.format(trouble.calmMistakeRate)}</span> when
          calm.
        </Text>
        <Text as="p" display="block" type="supporting">
          Measured across {trouble.clockedGames} games with clock data.
        </Text>
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-2 text-sm">
      {report.phases.map((point) => (
        <div key={point.phase ?? 'unknown'} className="flex items-baseline justify-between gap-3">
          <span>{point.phase === null ? 'Unknown phase' : PHASE_LABEL[point.phase]}</span>
          <Text type="supporting" className="font-mono">
            {point.totalCpLoss} cp lost over {point.games} games
          </Text>
        </div>
      ))}
      <Text as="p" display="block" type="supporting">
        {report.mistakeCount} mistakes counted.
      </Text>
      {report.timeTrouble.status === 'unavailable' ? (
        <Text as="p" display="block" type="supporting">
          {TIME_TROUBLE_UNAVAILABLE[report.timeTrouble.reason]}
        </Text>
      ) : null}
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
      className="flex items-center gap-3 rounded-surface border border-border-strong bg-raised px-4 py-3"
    >
      <Spinner size="sm" />
      <Text as="p" display="block" className="text-sm text-primary">
        Analyzing:{' '}
        {games
          .map((game) => `${game.whiteName ?? 'White'} vs ${game.blackName ?? 'Black'}`)
          .join(', ')}
      </Text>
    </div>
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
        {analysed} of {total} games analysed
      </Text>
      {active.length > 0 ? (
        // ST-093: at most three names, so the block stops re-wrapping on every
        // poll tick as games finish. That churn read as a screen flicker.
        <Text as="p" display="block" className="text-primary">
          Analyzing:{' '}
          {active
            .slice(0, 3)
            .map((game) => `${game.whiteName ?? 'White'} vs ${game.blackName ?? 'Black'}`)
            .join(', ')}
          {active.length > 3 ? ` +${active.length - 3} more` : ''}
        </Text>
      ) : null}
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
export function ReportRoute() {
  const navigate = useNavigate();
  const { stream, gameIds, tournamentId } = useSearch({ from: '/account/report' });
  // ST-096. The card shows the tournament the current upload attached to when
  // the import handed us its id, else the most recent one. The import route
  // already invalidates this query after an upload, so the card reflects it.
  const tournamentsQuery = useQuery({
    ...tournamentsQueryOptions(),
    enabled: stream === 'tournament',
  });
  const tournaments = tournamentsQuery.data?.tournaments ?? [];
  const cardTournament =
    tournamentId !== undefined
      ? tournaments.find((tournament) => tournament.id === tournamentId)
      : undefined;
  const cardSummary = cardTournament ?? tournaments[0];
  const cardDisabledReason =
    cardSummary !== undefined && cardSummary.gameCount < MIN_REPORT_GAMES
      ? `A report needs ${MIN_REPORT_GAMES} games; this tournament has played ${cardSummary.gameCount}.`
      : undefined;
  const tournamentCard =
    cardSummary !== undefined ? (
      <TournamentCard summary={cardSummary} disabledReason={cardDisabledReason} />
    ) : undefined;
  const gamesQuery = useQuery({
    ...gamesQueryOptions(stream),
    refetchInterval: (query) =>
      query.state.data !== undefined && query.state.data.games.some(isActiveGame) ? 5000 : false,
  });
  // ST-093: when the import handed us its own game ids, the analysing counter
  // counts only that batch; every other use of the games list stays stream-wide.
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
    ...reportQueryOptions(stream),
    refetchInterval: analyzingGames.length > 0 ? 5000 : false,
  });
  useEffect(() => {
    if (reportQuery.data !== undefined) track('report_viewed', { stream });
  }, [reportQuery.data, stream]);

  const onStreamChange = (next: Stream) => {
    void navigate({
      to: '/report',
      search: { stream: next },
    });
  };

  // A report exists: show it, plus a compact banner for any game still
  // analysing. Never swap the whole page to an "analysing" screen, which hid
  // the report and flickered as polling progressed.
  if (reportQuery.data !== undefined) {
    return (
      <ReportScreen
        stream={stream}
        report={reportQuery.data}
        onStreamChange={onStreamChange}
        analyzingGames={analyzingGames}
        tournamentCard={tournamentCard}
      />
    );
  }

  // No report yet. The endpoint answers 404 when the stream has no analysed
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
      <ReportHeader stream={stream} onStreamChange={onStreamChange} />
      {tournamentCard}
      {reportQuery.isPending ? (
        <ReportSkeleton />
      ) : notReadyError !== null ? (
        gamesQuery.isPending ? (
          <ReportSkeleton />
        ) : // ST-096. A running batch renders the analysing screen whatever the
        // report endpoint refused with: the moment one game completes, a
        // thin stream answers 422, and the refusal must not preempt games
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

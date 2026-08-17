import { Fragment, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { useQuery } from '@tanstack/react-query';
import { createColumnHelper, metaHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ApiRequestError } from '../api/account-api.ts';
import type {
  MotifReport,
  PhaseReport,
  Report,
  Stream,
  Weakness,
  WeaknessKind,
} from '../api/diagnosis-api.ts';
import { secondaryLinkClassName } from '../components/secondary-link.ts';
import { StreamToggle } from '../components/stream-toggle.tsx';
import {
  gamesQueryOptions,
  motifsQueryOptions,
  phasesQueryOptions,
  reportQueryOptions,
} from '../query-client.ts';

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
  not_online: 'Time trouble is measured on online games only.',
  no_clock_data: 'Your online games do not carry clock data.',
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

interface WeaknessTableMeta {
  expandedId: string | null;
  onToggle: (id: string) => void;
}

const weaknessFeatures = tableFeatures({
  tableMeta: metaHelper<WeaknessTableMeta>(),
});

const weaknessHelper = createColumnHelper<typeof weaknessFeatures, Weakness>();

const weaknessColumns = weaknessHelper.columns([
  weaknessHelper.accessor('rank', {
    header: 'Rank',
    cell: (info) => <span className="font-mono text-sm text-muted">#{info.getValue()}</span>,
  }),
  weaknessHelper.display({
    id: 'weakness',
    header: 'Weakness',
    cell: (info) => {
      const weakness = info.row.original;
      const expanded = info.table.options.meta?.expandedId === weakness.id;
      const expandable = weakness.kind !== 'opening';
      return (
        <div className="space-y-1">
          <span className="font-display text-base">{weakness.label}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Badge label={KIND_LABEL[weakness.kind]} variant="neutral" />
            {weakness.eco !== null ? (
              <span className="font-mono text-sm text-muted">{weakness.eco}</span>
            ) : null}
          </div>
          {expandable ? (
            <button
              type="button"
              onClick={() => info.table.options.meta?.onToggle(weakness.id)}
              aria-expanded={expanded}
              className="press inline-flex min-h-11 items-center font-ui text-sm text-accent underline hover:text-accent-hover"
            >
              {expanded ? 'Hide evidence' : 'Show evidence'}
            </button>
          ) : null}
        </div>
      );
    },
  }),
  weaknessHelper.accessor('ratingLeak', {
    header: 'Rating leak',
    cell: (info) => {
      const weakness = info.row.original;
      return (
        <span className="font-mono text-base">
          {weakness.saturated ? `at least ${info.getValue()}` : info.getValue()}
        </span>
      );
    },
  }),
  weaknessHelper.accessor('gamesAffected', {
    header: 'Games',
    cell: (info) => <span className="font-mono">{info.getValue()}</span>,
  }),
  weaknessHelper.accessor('occurrences', {
    header: 'Occurrences',
    cell: (info) => <span className="font-mono">{info.getValue()}</span>,
  }),
  weaknessHelper.accessor('halfPointsLost', {
    header: 'Half-points lost',
    cell: (info) => <span className="font-mono">{info.getValue()}</span>,
  }),
]);

export interface ReportScreenProps {
  stream: Stream;
  report: Report;
  playerId: string;
  onStreamChange: (stream: Stream) => void;
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
      <Link to="/account" className={secondaryLinkClassName}>
        Back to your account
      </Link>
      <Heading level={1}>{STREAM_HEADING[stream]}</Heading>
      <StreamToggle stream={stream} onChange={onStreamChange} ariaLabel="Report stream" />
      {meta !== undefined ? <p className="text-sm text-muted">{meta}</p> : null}
    </header>
  );
}
export function ReportScreen({ stream, report, playerId, onStreamChange }: ReportScreenProps) {
  const isEmpty = report.weaknesses.length === 0;
  const meta = `Reported ${generatedAtFormatter.format(new Date(report.generatedAt))} covering ${report.gamesCovered} games.`;
  return (
    <div className="space-y-6">
      <ReportHeader stream={stream} onStreamChange={onStreamChange} meta={meta} />
      {isEmpty ? (
        <EmptyReport report={report} />
      ) : (
        <WeaknessTable weaknesses={report.weaknesses} playerId={playerId} stream={stream} />
      )}
    </div>
  );
}

interface WeaknessTableProps {
  weaknesses: Weakness[];
  playerId: string;
  stream: Stream;
}

function WeaknessTable({ weaknesses, playerId, stream }: WeaknessTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const onToggle = (id: string) => setExpandedId((current) => (current === id ? null : id));
  const table = useTable({
    features: weaknessFeatures,
    columns: weaknessColumns,
    data: weaknesses,
    meta: { expandedId, onToggle },
  });

  return (
    <table className="reveal-in w-full border-collapse">
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => (
              <th
                key={header.id}
                scope="col"
                className="border-b border-border-subtle px-3 py-2 text-left font-ui text-xs text-muted"
              >
                {header.isPlaceholder ? null : <table.FlexRender header={header} />}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => {
          const weakness = row.original;
          const expanded = expandedId === weakness.id;
          return (
            <Fragment key={row.id}>
              <tr>
                {row.getAllCells().map((cell) => (
                  <td key={cell.id} className="border-b border-border-subtle px-3 py-3 align-top">
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
              {expanded && weakness.kind !== 'opening' ? (
                <tr>
                  <td
                    colSpan={row.getAllCells().length}
                    className="border-b border-border-subtle bg-sunken px-3 py-4"
                  >
                    <AggregateDetail kind={weakness.kind} playerId={playerId} stream={stream} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function AggregateDetail({
  kind,
  playerId,
  stream,
}: {
  kind: Exclude<WeaknessKind, 'opening'>;
  playerId: string;
  stream: Stream;
}) {
  return kind === 'motif' ? (
    <MotifAggregate playerId={playerId} stream={stream} />
  ) : (
    <PhaseAggregate kind={kind} playerId={playerId} stream={stream} />
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
  return <p className="mt-3 text-sm text-muted">This breakdown could not be loaded right now.</p>;
}

function MotifAggregate({ playerId, stream }: { playerId: string; stream: Stream }) {
  const { data, isPending, isError } = useQuery(motifsQueryOptions(playerId, stream));
  if (isPending) return <AggregateSkeleton />;
  if (isError || data === undefined) return <AggregateError />;
  return <MotifBreakdown report={data} />;
}

function PhaseAggregate({
  kind,
  playerId,
  stream,
}: {
  kind: 'phase' | 'time_trouble';
  playerId: string;
  stream: Stream;
}) {
  const { data, isPending, isError } = useQuery(phasesQueryOptions(playerId, stream));
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
          <span className="font-mono text-muted">
            {point.positions} positions, {point.totalCpLoss} cp lost
          </span>
        </div>
      ))}
      <p className="text-muted">
        {report.mistakeCount} mistakes counted.
        {report.withheld > 0
          ? ` ${report.withheld} positions held below the reporting threshold.`
          : ''}
        {report.unattributed > 0
          ? ` ${report.unattributed} positions not tied to a known motif.`
          : ''}
      </p>
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
      return <p className="mt-3 text-sm text-muted">{TIME_TROUBLE_UNAVAILABLE[trouble.reason]}</p>;
    }
    return (
      <div className="mt-3 space-y-1 text-sm">
        <p>Time trouble starts around move {trouble.fromMove}.</p>
        <p>
          <span className="font-mono">{rateFormatter.format(trouble.troubleMistakeRate)}</span> of
          time-trouble moves were mistakes, versus{' '}
          <span className="font-mono">{rateFormatter.format(trouble.calmMistakeRate)}</span> when
          calm.
        </p>
        <p className="text-muted">Measured across {trouble.clockedGames} games with clock data.</p>
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-2 text-sm">
      {report.phases.map((point) => (
        <div key={point.phase ?? 'unknown'} className="flex items-baseline justify-between gap-3">
          <span>{point.phase === null ? 'Unknown phase' : PHASE_LABEL[point.phase]}</span>
          <span className="font-mono text-muted">
            {point.totalCpLoss} cp lost over {point.games} games
          </span>
        </div>
      ))}
      <p className="text-muted">{report.mistakeCount} mistakes counted.</p>
      {report.timeTrouble.status === 'unavailable' ? (
        <p className="text-muted">{TIME_TROUBLE_UNAVAILABLE[report.timeTrouble.reason]}</p>
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

function NotReady({ stillAnalyzing }: { stillAnalyzing: boolean }) {
  if (stillAnalyzing) {
    return (
      <EmptyState
        title="Your games are still being analyzed"
        description="Analysis takes a couple of minutes after import. Come back and this report will be here."
        headingLevel={2}
      />
    );
  }
  return (
    <EmptyState
      title="No analyzed games in this stream yet"
      description="Import your games to get a ranked report. Tournament and online games are reported separately."
      headingLevel={2}
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
  const { playerId } = useParams({ from: '/account/players/$playerId/report' });
  const { stream } = useSearch({ from: '/account/players/$playerId/report' });

  const reportQuery = useQuery(reportQueryOptions(playerId, stream));
  const gamesQuery = useQuery({
    ...gamesQueryOptions(playerId, stream),
    enabled:
      reportQuery.isError &&
      reportQuery.error instanceof ApiRequestError &&
      reportQuery.error.status === 404,
  });

  const onStreamChange = (next: Stream) => {
    void navigate({
      to: '/account/players/$playerId/report',
      params: { playerId },
      search: { stream: next },
    });
  };

  if (reportQuery.isPending) {
    return (
      <div className="space-y-6">
        <ReportHeader stream={stream} onStreamChange={onStreamChange} />
        <ReportSkeleton />
      </div>
    );
  }

  if (reportQuery.isError) {
    const error = reportQuery.error;
    if (error instanceof ApiRequestError && error.status === 404) {
      const games = gamesQuery.data;
      const stillAnalyzing =
        games !== undefined &&
        games.games.some(
          (game) =>
            game.analysisStatus === 'pending' ||
            game.analysisStatus === 'queued' ||
            game.analysisStatus === 'analyzing',
        );
      return (
        <div className="space-y-6">
          <ReportHeader stream={stream} onStreamChange={onStreamChange} />
          <NotReady stillAnalyzing={stillAnalyzing} />
        </div>
      );
    }
    return (
      <div className="space-y-6">
        <ReportHeader stream={stream} onStreamChange={onStreamChange} />
        <ReportError />
      </div>
    );
  }

  return (
    <ReportScreen
      stream={stream}
      report={reportQuery.data}
      playerId={playerId}
      onStreamChange={onStreamChange}
    />
  );
}

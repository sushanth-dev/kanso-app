import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { useQuery } from '@tanstack/react-query';
import type { TournamentSummary } from '../api/tournament-api.ts';
import { tournamentsQueryOptions } from '../query-client.ts';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function gamesLabel(count: number): string {
  return count === 1 ? 'game' : 'games';
}

function dateRange(summary: TournamentSummary): string | null {
  if (summary.startedAt === null && summary.endedAt === null) return null;
  const start =
    summary.startedAt !== null ? dateFormatter.format(new Date(summary.startedAt)) : null;
  const end = summary.endedAt !== null ? dateFormatter.format(new Date(summary.endedAt)) : null;
  if (start !== null && end !== null && start === end) return start;
  if (start !== null && end !== null) return `${start} – ${end}`;
  return start ?? end;
}

export function TournamentCard({
  summary,
  disabledReason,
}: {
  summary: TournamentSummary;
  /** ST-096. Set on the report page while the tournament is under the report floor: the card greys out, the button stops, and the reason is stated in text. */
  disabledReason?: string;
}) {
  const range = dateRange(summary);
  const allAnalysed = summary.gameCount > 0 && summary.analysedCount === summary.gameCount;
  return (
    <Card
      className={disabledReason !== undefined ? 'opacity-75' : undefined}
      aria-disabled={disabledReason !== undefined ? true : undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <Text as="p" display="block" className="text-base">
            {summary.name}
          </Text>
          {summary.site !== null ? (
            <Text as="p" display="block" type="supporting" className="mt-1 text-sm">
              {summary.site}
            </Text>
          ) : null}
          {range !== null ? (
            <Text as="p" display="block" type="supporting" className="mt-1 text-sm">
              {range}
            </Text>
          ) : null}
        </div>
        <Badge
          label={
            allAnalysed
              ? `${summary.analysedCount} analysed`
              : `${summary.analysedCount} of ${summary.gameCount} analysed`
          }
          variant={allAnalysed ? 'success' : 'neutral'}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <Text type="supporting" className="font-mono text-sm">
          {summary.gameCount} {gamesLabel(summary.gameCount)}
        </Text>
        {disabledReason === undefined ? (
          <Button label="Open tournament" href={`/tournaments/${summary.id}`} />
        ) : (
          <Button label="Open tournament" isDisabled />
        )}
      </div>
      {disabledReason !== undefined ? (
        <Text as="p" display="block" className="mt-2 text-sm text-primary">
          {disabledReason}
        </Text>
      ) : null}
    </Card>
  );
}

export function TournamentsRoute() {
  const tournamentsQuery = useQuery(tournamentsQueryOptions());

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <Heading level={1}>Your tournaments</Heading>
        <Text as="p" display="block" type="supporting">
          One event at a time, with its games in round order.
        </Text>
      </header>

      {tournamentsQuery.isPending ? (
        <div role="status" aria-label="Loading tournaments" aria-busy="true" className="space-y-3">
          <div className="h-20 rounded-surface bg-sunken" />
          <div className="h-20 rounded-surface bg-sunken" />
        </div>
      ) : tournamentsQuery.isError ? (
        <EmptyState
          title="Your tournaments could not be loaded"
          description="Try again in a moment."
          headingLevel={2}
        />
      ) : tournamentsQuery.data.tournaments.length === 0 ? (
        <EmptyState
          title="No tournaments yet"
          description="Import tournament games to see each event here."
          headingLevel={2}
        />
      ) : (
        <ul className="stagger-in space-y-3">
          {tournamentsQuery.data.tournaments.map((summary) => (
            <li key={summary.id}>
              <TournamentCard summary={summary} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

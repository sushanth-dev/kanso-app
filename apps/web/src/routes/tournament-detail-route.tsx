import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { ApiRequestError } from '../api/account-api.ts';
import type { RoundDecay, TournamentDetail, TournamentGame } from '../api/tournament-api.ts';
import { roundDecayQueryOptions, tournamentQueryOptions } from '../query-client.ts';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const RESULT_LABEL: Record<Exclude<TournamentGame['result'], null>, string> = {
  win: 'W',
  draw: 'D',
  loss: 'L',
};

function gamesLabel(count: number): string {
  return count === 1 ? 'game' : 'games';
}

function dateRange(detail: TournamentDetail): string | null {
  if (detail.startedAt === null && detail.endedAt === null) return null;
  const start = detail.startedAt !== null ? dateFormatter.format(new Date(detail.startedAt)) : null;
  const end = detail.endedAt !== null ? dateFormatter.format(new Date(detail.endedAt)) : null;
  if (start !== null && end !== null && start === end) return start;
  if (start !== null && end !== null) return `${start} – ${end}`;
  return start ?? end;
}

function roundLabel(round: number | null): string {
  return round === null ? '—' : String(round);
}

function boardLabel(board: number | null): string {
  return board === null ? '—' : String(board);
}

function resultLabel(result: TournamentGame['result']): string | null {
  return result === null ? null : RESULT_LABEL[result];
}

function GameRow({ game }: { game: TournamentGame }) {
  const result = resultLabel(game.result);
  return (
    <li className="flex items-baseline gap-3 border-b border-border-subtle py-2 last:border-b-0">
      <Text type="supporting" className="w-8 shrink-0 font-mono text-sm">
        {roundLabel(game.round)}
      </Text>
      <Text type="supporting" className="w-8 shrink-0 font-mono text-sm">
        {boardLabel(game.board)}
      </Text>
      <span className="min-w-0 flex-1 truncate">{game.opponent ?? 'Unknown opponent'}</span>
      {result !== null ? (
        <Text className="font-mono text-sm">{result}</Text>
      ) : (
        <Text type="supporting" className="font-mono text-sm">
          —
        </Text>
      )}
      <Button label="Review" href={`/games/${game.id}`} variant="secondary" size="sm" />
    </li>
  );
}

function RoundDecayCard({ rounds }: { rounds: RoundDecay[] }) {
  if (rounds.length === 0) {
    return (
      <Card>
        <Heading level={2}>Round-by-round decay</Heading>
        <Text as="p" display="block" type="supporting" className="mt-2">
          Not enough analysed games to report a trend yet.
        </Text>
      </Card>
    );
  }
  return (
    <Card>
      <Heading level={2}>Round-by-round decay</Heading>
      <Text as="p" display="block" type="supporting" className="mt-1 text-sm">
        Average centipawn loss per move, by round. A rising line is the decay signal.
      </Text>
      <ul className="mt-3 space-y-2">
        {rounds.map((point) => (
          <li key={point.round} className="flex items-baseline justify-between gap-3">
            <Text type="supporting" className="font-mono text-sm">
              Round {point.round}
            </Text>
            <Text className="font-mono text-sm">
              {point.lossPerMove === null ? '—' : point.lossPerMove.toFixed(1)} cp/move
            </Text>
            <Text type="supporting" className="font-mono text-sm">
              {point.games} {gamesLabel(point.games)}
            </Text>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TournamentSkeleton() {
  return (
    <div role="status" aria-label="Loading tournament" aria-busy="true" className="space-y-4">
      <div className="h-8 w-48 rounded-control bg-sunken" />
      <div className="h-4 w-64 rounded-control bg-sunken" />
      <div className="h-40 rounded-surface bg-sunken" />
    </div>
  );
}

export function TournamentDetailRoute() {
  const { tournamentId } = useParams({ from: '/account/tournaments/$tournamentId' });
  const tournamentQuery = useQuery(tournamentQueryOptions(tournamentId));
  const decayQuery = useQuery(roundDecayQueryOptions(tournamentId));

  if (tournamentQuery.isPending) return <TournamentSkeleton />;

  if (tournamentQuery.isError) {
    const forbidden =
      tournamentQuery.error instanceof ApiRequestError && tournamentQuery.error.status === 403;
    return (
      <EmptyState
        title={forbidden ? 'This tournament is not yours' : 'This tournament could not be loaded'}
        description={
          forbidden ? 'You can only open your own tournaments.' : 'Go back and try again.'
        }
        headingLevel={2}
      />
    );
  }

  const detail = tournamentQuery.data;
  const range = dateRange(detail);
  const decay = decayQuery.isError ? null : (decayQuery.data ?? null);

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <Button label="Back to tournaments" href="/tournaments" variant="secondary" />
        <Heading level={1}>{detail.name}</Heading>
        {detail.site !== null ? (
          <Text as="p" display="block" type="supporting">
            {detail.site}
          </Text>
        ) : null}
        {range !== null ? (
          <Text as="p" display="block" type="supporting">
            {range}
          </Text>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Badge label={`${detail.score} / ${detail.scoreGames}`} variant="info" />
          {detail.scoreExcluded > 0 ? (
            <Badge label={`${detail.scoreExcluded} games not counted`} variant="neutral" />
          ) : null}
        </div>
      </header>

      {detail.games.length === 0 ? (
        <EmptyState
          title="No games in this tournament"
          description="Import tournament games to see them here."
          headingLevel={2}
        />
      ) : (
        <Card>
          <Heading level={2}>Games</Heading>
          <div className="mt-2 flex gap-3 border-b border-border-subtle pb-1">
            <Text type="supporting" className="w-8 shrink-0 font-mono text-sm">
              Rd
            </Text>
            <Text type="supporting" className="w-8 shrink-0 font-mono text-sm">
              Bd
            </Text>
            <Text type="supporting" className="min-w-0 flex-1 text-sm">
              Opponent
            </Text>
            <Text type="supporting" className="font-mono text-sm">
              Result
            </Text>
            <span className="w-16" />
          </div>
          <ul className="mt-1">
            {detail.games.map((game) => (
              <GameRow key={game.id} game={game} />
            ))}
          </ul>
        </Card>
      )}

      {decay !== null ? <RoundDecayCard rounds={decay.rounds} /> : null}
    </div>
  );
}

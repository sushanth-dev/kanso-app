import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { Stream } from '../api/diagnosis-api.ts';
import { StreamToggle } from '../components/stream-toggle.tsx';
import { gamesQueryOptions } from '../query-client.ts';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export function GamesRoute() {
  const navigate = useNavigate();
  const { stream } = useSearch({ from: '/account/games' });
  const gamesQuery = useQuery(gamesQueryOptions(stream));

  const onStreamChange = (next: Stream) => {
    void navigate({
      to: '/account/games',
      search: { stream: next },
    });
  };

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <Button label="Back to your account" href="/account" variant="secondary" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Heading level={1}>Your games</Heading>
          <StreamToggle stream={stream} onChange={onStreamChange} ariaLabel="Games stream" />
        </div>
      </header>

      {gamesQuery.isPending ? (
        <div role="status" aria-label="Loading games" aria-busy="true" className="space-y-3">
          <div className="h-20 rounded-surface bg-sunken" />
          <div className="h-20 rounded-surface bg-sunken" />
        </div>
      ) : gamesQuery.isError ? (
        <EmptyState
          title="Your games could not be loaded"
          description="Try again in a moment."
          headingLevel={2}
        />
      ) : gamesQuery.data.games.length === 0 ? (
        <EmptyState
          title={`No ${stream} games yet`}
          description="Import games to see them reviewed."
          headingLevel={2}
        />
      ) : (
        <ul className="stagger-in space-y-3">
          {gamesQuery.data.games.map((game) => {
            const analysed = game.analysisStatus === 'complete';
            return (
              <li key={game.id}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div>
                      <Text as="p" display="block" className="text-base">
                        {game.whiteName ?? 'Unknown'} vs {game.blackName ?? 'Unknown'}
                      </Text>
                      <Text as="p" display="block" type="supporting" className="mt-1 text-sm">
                        {game.event ?? 'Game'}
                        {game.playedAt !== null
                          ? ` · ${dateFormatter.format(new Date(game.playedAt))}`
                          : ''}
                      </Text>
                    </div>
                    <Text className="font-mono text-base">{game.result}</Text>
                  </div>
                  {analysed ? (
                    <div className="mt-3">
                      <Link href={`/account/games/${game.id}`}>Review</Link>
                    </div>
                  ) : (
                    <Text as="p" display="block" type="supporting" className="mt-3 text-sm">
                      Analysis in progress.
                    </Text>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

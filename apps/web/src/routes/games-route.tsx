import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
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
        <p className="text-muted">Your games could not be loaded right now.</p>
      ) : gamesQuery.data.games.length === 0 ? (
        <p className="text-muted">No {stream} games yet. Import games to see them reviewed.</p>
      ) : (
        <ul className="stagger-in space-y-3">
          {gamesQuery.data.games.map((game) => {
            const analysed = game.analysisStatus === 'complete';
            return (
              <li key={game.id}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div>
                      <p className="font-display text-base">
                        {game.whiteName ?? 'Unknown'} vs {game.blackName ?? 'Unknown'}
                      </p>
                      <p className="mt-1 text-sm text-muted">
                        {game.event ?? 'Game'}
                        {game.playedAt !== null
                          ? ` · ${dateFormatter.format(new Date(game.playedAt))}`
                          : ''}
                      </p>
                    </div>
                    <span className="font-mono text-base">{game.result}</span>
                  </div>
                  {analysed ? (
                    <div className="mt-3">
                      <Link href={`/account/games/${game.id}`}>Review</Link>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted">Analysis in progress.</p>
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

import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import type { Stream } from '../api/diagnosis-api.ts';
import { secondaryLinkClassName } from '../components/secondary-link.ts';
import { StreamToggle } from '../components/stream-toggle.tsx';
import { gamesQueryOptions } from '../query-client.ts';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export function GamesRoute() {
  const navigate = useNavigate();
  const { playerId } = useParams({ from: '/account/players/$playerId/games' });
  const { stream } = useSearch({ from: '/account/players/$playerId/games' });
  const gamesQuery = useQuery(gamesQueryOptions(playerId, stream));

  const onStreamChange = (next: Stream) => {
    void navigate({
      to: '/account/players/$playerId/games',
      params: { playerId },
      search: { stream: next },
    });
  };

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <Link to="/account" className={secondaryLinkClassName}>
          Back to your account
        </Link>
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
            const opponent = game.playerColor === 'white' ? game.blackName : game.whiteName;
            const analysed = game.analysisStatus === 'complete';
            return (
              <li key={game.id}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div>
                      <p className="font-display text-base">
                        {opponent ? `vs ${opponent}` : 'Opponent unknown'}
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
                    <Link
                      to="/account/players/$playerId/games/$gameId"
                      params={{ playerId, gameId: game.id }}
                      className="mt-3 inline-flex min-h-11 items-center font-ui text-sm text-accent underline press"
                    >
                      Review
                    </Link>
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

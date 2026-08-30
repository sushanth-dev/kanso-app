import { useState } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { GameSummary, Stream } from '../api/diagnosis-api.ts';
import { diagnosisApi } from '../api/diagnosis-api.ts';
import { StreamToggle } from '../components/stream-toggle.tsx';
import { gamesQueryOptions } from '../query-client.ts';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function GameCard({ game, stream }: { game: GameSummary; stream: Stream }) {
  const queryClient = useQueryClient();
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: () => diagnosisApi.deleteGame(game.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['games', stream] });
    },
  });

  const analysed = game.analysisStatus === 'complete';
  const failed = game.analysisStatus === 'failed';
  // ST-095: a pending game with no recorded side never starts on its own.
  const needsSide = game.analysisStatus === 'pending' && game.playerColor === null;

  const onConfirmDelete = async () => {
    setDeleteError(null);
    try {
      await deleteMutation.mutateAsync();
      setIsDeleteOpen(false);
    } catch {
      setDeleteError('The game could not be deleted. Please try again.');
    }
  };

  const onRetry = async () => {
    setIsRetrying(true);
    try {
      await diagnosisApi.queueAnalysis(game.id);
      void queryClient.invalidateQueries({ queryKey: ['games', stream] });
    } catch {
      // A failed re-queue stays failed; the refetch shows the current state.
      void queryClient.invalidateQueries({ queryKey: ['games', stream] });
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <Text as="p" display="block" className="text-base">
            {game.whiteName ?? 'Unknown'} vs {game.blackName ?? 'Unknown'}
          </Text>
          <Text as="p" display="block" type="supporting" className="mt-1 text-sm">
            {game.event ?? 'Game'}
            {game.playedAt !== null ? ` · ${dateFormatter.format(new Date(game.playedAt))}` : ''}
          </Text>
        </div>
        <Text className="font-mono text-base">{game.result}</Text>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {analysed ? (
            <Button label="Review" href={`/games/${game.id}`} />
          ) : failed ? (
            <>
              <Text as="p" display="block" type="supporting" className="text-sm">
                Analysis failed.
              </Text>
              <Button
                label="Retry"
                variant="secondary"
                isDisabled={isRetrying}
                onClick={() => {
                  void onRetry();
                }}
              />
            </>
          ) : needsSide ? (
            <Text as="p" display="block" type="supporting" className="text-sm">
              Waiting for your side: open the game and pick the colour you played.
            </Text>
          ) : (
            <Text as="p" display="block" type="supporting" className="text-sm">
              Analysis in progress.
            </Text>
          )}
          {!analysed ? (
            <Button label="View game" href={`/games/${game.id}`} variant="secondary" />
          ) : null}
        </div>
        <Button label="Delete" variant="destructive" onClick={() => setIsDeleteOpen(true)} />
      </div>
      <AlertDialog
        isOpen={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        title="Delete this game?"
        description="This removes the game and its analysis. This cannot be undone."
        actionLabel="Delete"
        isActionLoading={deleteMutation.isPending}
        onAction={() => {
          void onConfirmDelete();
        }}
      />
      {deleteError !== null ? (
        <Text as="p" display="block" type="supporting" className="mt-3 text-sm text-danger">
          {deleteError}
        </Text>
      ) : null}
    </Card>
  );
}

export function GamesRoute() {
  const navigate = useNavigate();
  const { stream } = useSearch({ from: '/account/games' });
  const gamesQuery = useQuery(gamesQueryOptions(stream));

  const onStreamChange = (next: Stream) => {
    void navigate({
      to: '/games',
      search: { stream: next },
    });
  };

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Heading level={1}>Your games</Heading>
          <StreamToggle stream={stream} onChange={onStreamChange} ariaLabel="Games stream" />
        </div>
        {/* ST-096. The games list is where waiting-for-side and in-progress
            situations land, so it carries the paths out of itself: import more
            games, or read the report for this stream. */}
        <div className="flex flex-wrap gap-3">
          <Button label="Import games" href="/import" variant="secondary" />
          <Button label="View report" href={`/report?stream=${stream}`} variant="secondary" />
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
          {gamesQuery.data.games.map((game) => (
            <li key={game.id}>
              <GameCard game={game} stream={stream} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

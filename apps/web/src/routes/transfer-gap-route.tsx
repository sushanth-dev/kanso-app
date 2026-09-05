import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { diagnosisApi, type TransferGap } from '../api/diagnosis-api.ts';
import { transferGapQueryOptions, transferGapSeriesQueryOptions } from '../query-client.ts';
import { GapSeriesCard } from '../components/gap-series.tsx';

function ratingCell(label: string, rating: number | null, gap: number | null) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <Text as="span" display="block" type="supporting">
        {label}
      </Text>
      <div className="flex items-baseline gap-3">
        <Text className="font-mono">{rating === null ? '—' : rating}</Text>
        {gap === null ? (
          <Text type="supporting" className="font-mono text-sm">
            —
          </Text>
        ) : (
          <Text
            className={`font-mono text-sm ${gap > 0 ? 'text-danger' : gap < 0 ? 'text-success' : ''}`}
          >
            {gap > 0 ? `+${gap}` : gap}
          </Text>
        )}
      </div>
    </div>
  );
}

function TransferGapCard({ gap }: { gap: TransferGap }) {
  return (
    <Card>
      <Heading level={2}>Online vs over the board</Heading>
      <Text as="p" display="block" type="supporting" className="mt-1 text-sm">
        Rapid rating on each platform, against your over-the-board rating.
      </Text>
      <div className="mt-3 space-y-2">
        {ratingCell('Over the board', gap.overTheBoardRating, null)}
        {ratingCell('Chess.com', gap.chesscom.rating, gap.chesscom.gap)}
        {ratingCell('Lichess', gap.lichess.rating, gap.lichess.gap)}
      </div>
      <Text as="p" display="block" type="supporting" className="mt-3 text-sm">
        A positive gap means your online rating runs ahead of your over-the-board rating.
      </Text>
    </Card>
  );
}

export function TransferGapRoute() {
  const queryClient = useQueryClient();
  const gapQuery = useQuery(transferGapQueryOptions());
  const seriesQuery = useQuery(transferGapSeriesQueryOptions());
  const refreshing = gapQuery.isFetching;

  const onRefresh = () => {
    void queryClient.fetchQuery({
      ...transferGapQueryOptions(),
      queryFn: () => diagnosisApi.getTransferGap(true),
      // A refresh click must reach the platforms even seconds after the last
      // load; without this the spread's 30s staleTime serves the cache.
      staleTime: 0,
    });
    // The series reads the stored snapshot; a refresh that moves the rating
    // must move the reference the points read against.
    void queryClient.fetchQuery({ ...transferGapSeriesQueryOptions(), staleTime: 0 });
  };

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Heading level={1}>Rating transfer gap</Heading>
          <Button
            label={refreshing ? 'Refreshing...' : 'Refresh ratings'}
            variant="secondary"
            onClick={onRefresh}
            isDisabled={refreshing}
          />
        </div>
        <Text as="p" display="block" type="supporting">
          How your online rating compares to your over-the-board rating.
        </Text>
      </header>

      {gapQuery.isPending ? (
        <div role="status" aria-label="Loading rating gap" aria-busy="true" className="space-y-3">
          <div className="h-32 rounded-surface bg-sunken" />
        </div>
      ) : gapQuery.isError ? (
        <EmptyState
          title="Your rating gap could not be loaded"
          description="Try again in a moment."
          headingLevel={2}
        />
      ) : (
        <TransferGapCard gap={gapQuery.data} />
      )}

      {seriesQuery.isPending ? (
        <div role="status" aria-label="Loading gap series" aria-busy="true" className="space-y-3">
          <div className="h-40 rounded-surface bg-sunken" />
        </div>
      ) : seriesQuery.isError ? (
        <EmptyState
          title="The gap series could not be loaded"
          description="Try again in a moment."
          headingLevel={2}
        />
      ) : (
        <GapSeriesCard series={seriesQuery.data} />
      )}
    </div>
  );
}

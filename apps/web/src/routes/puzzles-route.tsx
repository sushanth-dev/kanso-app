/**
 * ST-107. The puzzles page, ported from the prototype's training page: one
 * heading, three pill tabs, and a row list per bucket. The drill itself stays
 * on /practice; every link here hands the first pending group to it.
 */
import { useEffect, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ApiRequestError } from '../api/account-api.ts';
import type { PracticeQueueItem } from '../api/diagnosis-api.ts';
import { ME_QUERY_KEY, practiceQueueQueryOptions } from '../query-client.ts';

const DAY_MS = 86_400_000;

type QueueTab = 'pending' | 'upcoming' | 'mastered';

const TABS: readonly { key: QueueTab; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'mastered', label: 'Mastered' },
];

/** 'hangingPiece' -> 'Hanging piece': the theme slug becomes a readable label. */
function groupLabel(group: string): string {
  const spaced = group.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** The drill for one group, in the tournament stream the queue serves. */
function drillHref(item: PracticeQueueItem): string {
  return `/practice?kind=${item.kind}&group=${encodeURIComponent(item.group)}&stream=tournament`;
}

function dueLabel(nextReviewAt: string): string {
  const days = Math.ceil((new Date(nextReviewAt).getTime() - Date.now()) / DAY_MS);
  return days === 1 ? 'Due tomorrow' : `Due in ${days} days`;
}

function QueueRow({ item, end }: { item: PracticeQueueItem; end: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-border-subtle py-3 last:border-b-0">
      <div className="flex items-baseline gap-3">
        <Text className="font-display text-base">{groupLabel(item.group)}</Text>
        <Text type="supporting" className="font-mono text-sm">
          {item.rating}
        </Text>
      </div>
      <div className="flex items-center gap-2">{end}</div>
    </li>
  );
}

function QueueList({
  items,
  endFor,
}: {
  items: PracticeQueueItem[];
  endFor: (item: PracticeQueueItem) => React.ReactNode;
}) {
  return (
    <Card>
      <ul>
        {items.map((item) => (
          <QueueRow key={item.puzzleId} item={item} end={endFor(item)} />
        ))}
      </ul>
    </Card>
  );
}

function PendingTab({ due }: { due: PracticeQueueItem[] }) {
  const first = due[0];
  if (first === undefined) return null;
  return (
    <div className="space-y-4">
      <Link href={drillHref(first)}>Practice now</Link>
      <QueueList items={due} endFor={() => <Badge label="Due now" variant="warning" />} />
    </div>
  );
}

function UpcomingTab({ upcoming }: { upcoming: PracticeQueueItem[] }) {
  return (
    <QueueList
      items={upcoming}
      endFor={(item) => (
        <>
          <Text type="supporting" className="text-sm">
            {dueLabel(item.nextReviewAt)}
          </Text>
          {item.reviewLevel >= 1 && item.reviewLevel <= 3 ? (
            <Badge label={`Box ${item.reviewLevel}`} variant="neutral" />
          ) : null}
        </>
      )}
    />
  );
}

function MasteredTab({ mastered }: { mastered: PracticeQueueItem[] }) {
  return <QueueList items={mastered} endFor={() => <Badge label="Mastered" variant="success" />} />;
}

export function PuzzlesRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<QueueTab>('pending');
  const queueQuery = useQuery(practiceQueueQueryOptions());

  const unauthorized =
    queueQuery.isError &&
    queueQuery.error instanceof ApiRequestError &&
    queueQuery.error.status === 401;

  // The session died while the page was open: drop the account cache and let
  // sign-in rebuild it, the same shape every mutation path here uses.
  useEffect(() => {
    if (!unauthorized) return;
    queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
    void navigate({ to: '/sign-in' });
  }, [unauthorized, queryClient, navigate]);

  if (queueQuery.isPending) {
    return (
      <div role="status" aria-busy="true" className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (queueQuery.isError) {
    if (unauthorized) return null;
    return (
      <EmptyState
        title="This page could not be loaded"
        description="The drill queue could not be reached. Try again, or go back to your report."
        headingLevel={1}
        actions={
          <Button label="Retry" variant="primary" onClick={() => void queueQuery.refetch()} />
        }
      />
    );
  }

  const { due, upcoming, mastered } = queueQuery.data;
  const counts: Record<QueueTab, number> = {
    pending: due.length,
    upcoming: upcoming.length,
    mastered: mastered.length,
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Heading level={1}>Puzzles</Heading>
        <Text as="p" display="block" type="supporting">
          Your drill queue: what is pending now, what comes back for review, and what you have
          mastered.
        </Text>
      </header>

      <nav aria-label="Queue tabs" className="flex flex-wrap gap-2">
        {TABS.map(({ key, label }) => (
          <Button
            key={key}
            label={`${label} (${counts[key]})`}
            variant={tab === key ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          />
        ))}
      </nav>

      {tab === 'pending' ? (
        due.length > 0 ? (
          <PendingTab due={due} />
        ) : (
          <EmptyState
            title="All caught up!"
            description="No puzzles are waiting on you right now."
            headingLevel={2}
            actions={<Link href="/report">Go to your report</Link>}
          />
        )
      ) : tab === 'upcoming' ? (
        upcoming.length > 0 ? (
          <UpcomingTab upcoming={upcoming} />
        ) : (
          <EmptyState
            title="Nothing scheduled yet"
            description="Solve puzzles to schedule the next reviews."
            headingLevel={2}
          />
        )
      ) : mastered.length > 0 ? (
        <MasteredTab mastered={mastered} />
      ) : (
        <EmptyState
          title="Nothing mastered yet"
          description="Solve the same puzzle across reviews to master it."
          headingLevel={2}
        />
      )}
    </div>
  );
}

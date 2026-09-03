/**
 * ST-115. The debrief: where a tournament import now ends. Three anchored
 * sections in the loop's order - what happened (the batch's report), your one
 * focus, your first drill - each composing a surface that already exists over
 * the same query keys. Nothing recomputes and no aggregate is duplicated; the
 * debrief is the moment of highest motivation, not a second report page.
 */
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ApiRequestError } from '../api/account-api.ts';
import type { Stream, Weakness } from '../api/diagnosis-api.ts';
import { focusQueryOptions, focusesQueryOptions, reportQueryOptions } from '../query-client.ts';
import { UpgradePrompt } from '../components/upgrade-prompt.tsx';
import { StatusMessage } from '../components/status-message.tsx';
import { CatalogueList, CoachInstructionForm, useSetFocus } from './focus-route.tsx';
import { ScopedReportRoute } from './report-route.tsx';

/** Section two: the one focus, composed from the focus page's own pieces. */
function DebriefFocus() {
  const focusesQuery = useQuery(focusesQueryOptions());
  const focusQuery = useQuery(focusQueryOptions());
  const { setFocus, submitting, formError } = useSetFocus();

  if (focusQuery.isPending || focusesQuery.isPending) {
    return (
      <div role="status" aria-label="Loading focus" aria-busy="true" className="space-y-4">
        <div className="h-4 w-64 rounded-control bg-sunken" />
        <div className="h-32 rounded-surface bg-sunken" />
      </div>
    );
  }

  if (
    focusQuery.isError &&
    focusQuery.error instanceof ApiRequestError &&
    focusQuery.error.code === 'upgrade_required'
  ) {
    return <UpgradePrompt title="Your focus is part of the paid loop" />;
  }

  if (
    focusQuery.isError &&
    !(focusQuery.error instanceof ApiRequestError && focusQuery.error.status === 404)
  ) {
    return (
      <EmptyState
        title="Your focus could not be loaded"
        description="Try again, or set it later on the focus page."
        headingLevel={3}
      />
    );
  }

  const activeFocus = focusQuery.data;
  if (activeFocus !== undefined) {
    return (
      <Card className="space-y-2 p-4">
        <Text type="supporting" className="font-ui text-xs">
          working on
        </Text>
        <Text className="font-display text-base">
          {activeFocus.catalogue !== null
            ? activeFocus.catalogue.title
            : "Your coach's instruction"}
        </Text>
        <Link href="/focus">Work on it on the focus page</Link>
      </Card>
    );
  }

  const catalogue = focusesQuery.data ?? [];
  return (
    <div className="space-y-6">
      {formError !== null ? <StatusMessage tone="error">{formError}</StatusMessage> : null}
      {submitting ? <StatusMessage tone="info">Setting your focus...</StatusMessage> : null}
      {focusesQuery.isError ? (
        <StatusMessage tone="error">
          The focus catalogue could not be loaded right now. Try again.
        </StatusMessage>
      ) : (
        <>
          <CatalogueList
            catalogue={catalogue}
            submitting={submitting}
            onChoose={(key) => {
              void setFocus({ source: 'self', catalogueKey: key });
            }}
          />
          <CoachInstructionForm
            catalogue={catalogue}
            submitting={submitting}
            onSubmit={(body) => {
              void setFocus(body);
            }}
          />
        </>
      )}
    </div>
  );
}

/** Section three: the first drill, the same deep link the report card builds. */
function DebriefDrill({ tournamentId }: { tournamentId: string | undefined }) {
  // The same key the embedded report reads, so this is cache, not a second
  // fetch: the debrief never asks the diagnosis endpoint twice.
  const reportQuery = useQuery(reportQueryOptions('tournament', tournamentId));

  if (reportQuery.data !== undefined) {
    const first =
      reportQuery.data.weaknesses.find(
        (w): w is Weakness & { groupKey: string } => w.groupKey !== null,
      ) ?? null;
    if (first === null) {
      return (
        <Text as="p" display="block" type="supporting">
          No weakness in this report has a drill yet.
        </Text>
      );
    }
    const href = `/practice?kind=${first.kind}&group=${encodeURIComponent(first.groupKey)}&label=${encodeURIComponent(first.label)}&stream=tournament`;
    return (
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Text type="supporting" className="font-mono text-sm">
            #{first.rank}
          </Text>
          <Text className="font-display text-base">{first.label}</Text>
        </div>
        <Button label="Practise the first drill" href={href} variant="primary" />
      </Card>
    );
  }

  return (
    <Text as="p" display="block" type="supporting">
      Your first drill appears when the report lands.
    </Text>
  );
}

export function DebriefRoute() {
  const navigate = useNavigate();
  const { gameIds, tournamentId, gameId } = useSearch({ from: '/account/debrief' });

  if (gameIds === undefined || gameIds.length === 0) {
    return (
      <div className="space-y-6">
        <Heading level={1}>The debrief</Heading>
        <EmptyState
          title="No batch to debrief"
          description="Import a tournament's games, and the debrief meets you here."
          headingLevel={2}
        />
        <Link href="/import">Go to import</Link>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <Link href="/import">Back to import</Link>
        <Link
          onClick={() => {
            // Skip lands where the import ends today: an under-threshold
            // batch on the imported game's review, everything else on the
            // batch's report.
            if (gameId !== undefined) {
              void navigate({ to: '/games/$gameId', params: { gameId } });
              return;
            }
            void navigate({
              to: '/report',
              search: {
                stream: 'tournament' as Stream,
                gameIds,
                ...(tournamentId !== undefined ? { tournamentId } : {}),
              },
            });
          }}
        >
          Skip the debrief
        </Link>
      </div>

      <ScopedReportRoute
        stream="tournament"
        tournamentId={tournamentId}
        gameIds={gameIds}
        onStreamChange={(next: Stream) => {
          // A stream switch leaves the debrief for the full report: the
          // debrief debriefs one batch, and the toggle belongs to the page
          // that owns every batch.
          void navigate({ to: '/report', search: { stream: next } });
        }}
      />

      <section className="space-y-4">
        <Heading level={2}>Your one focus</Heading>
        <DebriefFocus />
      </section>

      <section className="space-y-4">
        <Heading level={2}>Your first drill</Heading>
        <DebriefDrill tournamentId={tournamentId} />
      </section>
    </div>
  );
}

import { useEffect } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { ApiRequestError } from '../api/account-api.ts';
import { sharedProofSheetApi, type SharedProofSheet } from '../api/proof-sheet-api.ts';
import { Mark } from '../components/mark.tsx';
import { FigureTypeNote } from '../components/figure-type.tsx';

const STREAM_LABEL: Record<SharedProofSheet['stream'], string> = {
  tournament: 'Tournament',
  online: 'Online',
};

// The word carries the meaning; the glyph is the second channel, so a verdict
// never reads as a glyph alone.
const TREND_ARROW: Record<Exclude<SharedProofSheet['trend'], 'insufficient_evidence'>, string> = {
  improving: '↑',
  flat: '→',
  declining: '↓',
};

const valueFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const periodFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function formatValue(value: number | null): string {
  return value === null ? '—' : valueFormatter.format(value);
}

function gamesLabel(count: number): string {
  return count === 1 ? 'game' : 'games';
}

function verdictSentence(sheet: SharedProofSheet): string {
  switch (sheet.trend) {
    case 'improving':
      return 'It is improving.';
    case 'flat':
      return 'It has not changed yet.';
    case 'declining':
      return 'It is declining.';
    case 'insufficient_evidence':
      return 'There is not enough evidence yet to say whether it is helping.';
  }
}

export function SharedProofSheetScreen({ sheet }: { sheet: SharedProofSheet }) {
  useEffect(() => {
    document.title = `${sheet.focusTitle} · Kanso Chess`;
    return () => {
      document.title = 'Kanso Chess';
    };
  }, [sheet.focusTitle]);

  const hasVerdict = sheet.trend !== 'insufficient_evidence';

  return (
    <main className="print-sheet mx-auto w-full max-w-2xl px-4 py-16 font-ui">
      <div aria-hidden="true" className="mb-6">
        <Mark size={28} />
      </div>
      <Text as="p" display="block" type="supporting" className="text-sm reveal-in">
        {sheet.playerDisplayName}'s focus
      </Text>
      <Heading level={1} className="reveal-in">
        {sheet.focusTitle}
      </Heading>
      <Text
        as="p"
        display="block"
        className="mt-6 text-2xl font-display leading-snug text-primary reveal-in"
      >
        {verdictSentence(sheet)}
        {sheet.trend !== 'insufficient_evidence' ? (
          <span aria-hidden="true" className="ml-2 font-mono">
            {TREND_ARROW[sheet.trend]}
          </span>
        ) : null}
      </Text>

      {hasVerdict ? (
        <dl className="reveal-in mt-8 space-y-6">
          <div>
            <dt className="text-sm text-muted">Before the focus</dt>
            <dd className="mt-1 font-mono text-lg text-primary">
              {formatValue(sheet.beforeValue)} <Text type="supporting">{sheet.unit}</Text>
            </dd>
            <dd className="mt-1 text-sm text-muted">
              over {sheet.gamesBefore} {gamesLabel(sheet.gamesBefore)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Since the focus</dt>
            <dd className="mt-1 font-mono text-lg text-primary">
              {formatValue(sheet.afterValue)} <Text type="supporting">{sheet.unit}</Text>
            </dd>
            <dd className="mt-1 text-sm text-muted">
              over {sheet.gamesAfter} {gamesLabel(sheet.gamesAfter)}
            </dd>
          </div>
        </dl>
      ) : (
        <Text as="p" display="block" type="supporting" className="mt-4 reveal-in">
          {sheet.gamesBefore} {gamesLabel(sheet.gamesBefore)} before the focus, {sheet.gamesAfter}{' '}
          {gamesLabel(sheet.gamesAfter)} since. More games will make a verdict possible.
        </Text>
      )}

      {/* ST-175. The proof sheet carries no estimate: every figure here, the
          verdict and the two halves behind it, is counted from games. The note
          sits under the figures rather than in a footer, and it names the
          ingredient so "observed" teaches the reader something. */}
      <FigureTypeNote
        type="observed"
        detail="every figure on this page is counted from these games, not modelled from engine scores."
      />

      <Text as="p" display="block" type="supporting" className="mt-8 text-sm reveal-in">
        {STREAM_LABEL[sheet.stream]} games · {periodFormatter.format(new Date(sheet.periodStart))}{' '}
        to {periodFormatter.format(new Date(sheet.periodEnd))}
      </Text>

      {sheet.coachInstruction ? (
        <section className="mt-8 reveal-in">
          <Text as="p" display="block" type="supporting" className="text-sm">
            The coach's instruction
          </Text>
          <blockquote className="mt-1 whitespace-pre-wrap font-display text-xl leading-snug">
            {sheet.coachInstruction}
          </blockquote>
        </section>
      ) : null}
    </main>
  );
}

export function SharedProofSheetRoute() {
  const { token } = useParams({ from: '/shared/proof-sheets/$token' });
  const query = useQuery({
    queryKey: ['shared-proof-sheet', token],
    queryFn: () => sharedProofSheetApi.getShared(token),
    retry: false,
  });

  if (query.isPending) {
    return (
      <main
        role="status"
        aria-label="Loading"
        aria-busy="true"
        className="print-sheet mx-auto w-full max-w-2xl px-4 py-16 font-ui"
      >
        <div className="reveal-in h-8 w-48 rounded-control bg-sunken" />
        <div className="reveal-in mt-3 h-4 w-72 rounded-control bg-sunken" />
      </main>
    );
  }

  // Revoked, expired, and unknown links are the API's one indistinguishable 404;
  // the page says the same thing for all of them rather than naming which case.
  if (query.isError && query.error instanceof ApiRequestError && query.error.status === 404) {
    return (
      <main className="print-sheet mx-auto w-full max-w-2xl px-4 py-16 font-ui">
        <Heading level={1} className="reveal-in">
          This link is no longer available.
        </Heading>
      </main>
    );
  }

  // A fetch that never reached the server (a network failure or a 5xx) is a
  // different state from a revoked link: the reader may still be able to reach
  // the page, so offer a retry rather than a dead end.
  if (query.isError) {
    return (
      <main className="print-sheet mx-auto w-full max-w-2xl px-4 py-16 font-ui">
        <Heading level={1} className="reveal-in">
          This page could not be reached.
        </Heading>
        <Text as="p" display="block" type="supporting" className="mt-4 reveal-in">
          Check your connection and try again.
        </Text>
        <Button
          label="Try again"
          variant="primary"
          clickAction={() => {
            void query.refetch();
          }}
          className="mt-6 reveal-in press"
        />
      </main>
    );
  }

  return <SharedProofSheetScreen sheet={query.data} />;
}

import { useEffect } from 'react';
import { Heading } from '@astryxdesign/core/Heading';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { sharedProofSheetApi, type SharedProofSheet } from '../api/proof-sheet-api.ts';

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
    <main className="mx-auto w-full max-w-2xl px-4 py-16 font-ui">
      <p className="text-sm text-muted">{sheet.playerDisplayName}'s focus</p>
      <Heading level={1}>{sheet.focusTitle}</Heading>

      <p className="mt-6 text-2xl font-display leading-snug text-primary">
        {verdictSentence(sheet)}
        {sheet.trend !== 'insufficient_evidence' ? (
          <span aria-hidden="true" className="ml-2 font-mono">
            {TREND_ARROW[sheet.trend]}
          </span>
        ) : null}
      </p>

      {hasVerdict ? (
        <dl className="mt-8 space-y-6">
          <div>
            <dt className="text-sm text-muted">Before the focus</dt>
            <dd className="mt-1 font-mono text-lg text-primary">
              {formatValue(sheet.beforeValue)} <span className="text-muted">{sheet.unit}</span>
            </dd>
            <dd className="mt-1 text-sm text-muted">
              over {sheet.gamesBefore} {gamesLabel(sheet.gamesBefore)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Since the focus</dt>
            <dd className="mt-1 font-mono text-lg text-primary">
              {formatValue(sheet.afterValue)} <span className="text-muted">{sheet.unit}</span>
            </dd>
            <dd className="mt-1 text-sm text-muted">
              over {sheet.gamesAfter} {gamesLabel(sheet.gamesAfter)}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-4 text-muted">
          {sheet.gamesBefore} {gamesLabel(sheet.gamesBefore)} before the focus, {sheet.gamesAfter}{' '}
          {gamesLabel(sheet.gamesAfter)} since. More games will make a verdict possible.
        </p>
      )}

      <p className="mt-8 text-sm text-muted">
        {STREAM_LABEL[sheet.stream]} games · {periodFormatter.format(new Date(sheet.periodStart))}{' '}
        to {periodFormatter.format(new Date(sheet.periodEnd))}
      </p>

      {sheet.coachInstruction ? (
        <section className="mt-8">
          <p className="text-sm text-muted">The coach's instruction</p>
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
        className="mx-auto w-full max-w-2xl px-4 py-16 font-ui"
      >
        <div className="h-8 w-48 rounded-control bg-sunken" />
        <div className="mt-3 h-4 w-72 rounded-control bg-sunken" />
      </main>
    );
  }

  // Revoked, expired, and unknown links are the API's one indistinguishable 404;
  // the page says the same thing for all of them rather than naming which case.
  if (query.isError) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-16 font-ui">
        <Heading level={1}>This link is no longer available.</Heading>
      </main>
    );
  }

  return <SharedProofSheetScreen sheet={query.data} />;
}

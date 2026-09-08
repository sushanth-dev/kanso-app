import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useParams } from '@tanstack/react-router';
import { ApiRequestError } from '../api/account-api.ts';
import { sharedCardApi } from '../api/report-share-api.ts';
import { Mark } from '../components/mark.tsx';

/**
 * ST-127. The shared report card: the headline leak number, its weakness
 * label, and the mark - and nothing else. No games, no opponent names, no
 * account identity, no second weakness: the API's payload is two fields and
 * this page renders exactly those two fields. A phone gets the native share
 * sheet (the point of a card is that it travels); a desktop gets copy.
 */
export function SharedCardScreen({ card }: { card: { ratingLeak: number; label: string } }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator.share === 'function';
  // The router's location, not `window.location`: the card must share its own
  // link under any history adapter.
  const href = useLocation({ select: (location) => location.href });
  const url = new URL(href, window.location.origin).toString();
  const text = `My biggest chess leak: ${card.label} - ${card.ratingLeak} rating points`;

  useEffect(() => {
    document.title = `${card.ratingLeak} rating points · Kanso Chess`;
    return () => {
      document.title = 'Kanso Chess';
    };
  }, [card.ratingLeak]);

  async function handleShare() {
    if (canShare) {
      // A cancelled share sheet is the user's choice, not an error.
      await navigator.share({ title: 'Kanso Chess', text, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <Text as="p" display="block" type="supporting" className="text-sm">
        A Kanso Chess diagnosis
      </Text>
      <Heading level={1}>{card.label}</Heading>
      <div className="mt-6 flex items-baseline gap-3">
        <Text className="font-mono text-6xl text-primary">{card.ratingLeak}</Text>
        <Text className="text-lg">rating points</Text>
      </div>
      <div className="mt-8">
        <Button
          label={canShare ? 'Share card' : copied ? 'Copied' : 'Copy link'}
          variant="primary"
          onClick={() => {
            void handleShare();
          }}
          className="min-h-11 press"
        />
      </div>
    </>
  );
}

export function SharedCardRoute() {
  const { token } = useParams({ from: '/shared/cards/$token' });
  const query = useQuery({
    queryKey: ['shared-card', token],
    queryFn: () => sharedCardApi.getShared(token),
    retry: false,
  });

  if (query.isPending) {
    return (
      <main
        role="status"
        aria-label="Loading"
        aria-busy="true"
        className="reveal-in mx-auto w-full max-w-2xl px-4 py-16 font-ui"
      >
        <div className="h-8 w-48 rounded-control bg-sunken" />
        <div className="mt-3 h-4 w-72 rounded-control bg-sunken" />
      </main>
    );
  }

  // Revoked, expired, and unknown links are the API's one indistinguishable 404;
  // the page says the same thing for all of them rather than naming which case.
  if (query.isError && query.error instanceof ApiRequestError && query.error.status === 404) {
    return (
      <main className="reveal-in mx-auto w-full max-w-2xl px-4 py-16 font-ui">
        <Heading level={1}>This link is no longer available.</Heading>
      </main>
    );
  }

  // A fetch that never reached the server (a network failure or a 5xx) is a
  // different state from a dead link: the reader may still be able to reach
  // the page, so offer a retry rather than a dead end.
  if (query.isError) {
    return (
      <main className="reveal-in mx-auto w-full max-w-2xl px-4 py-16 font-ui">
        <Heading level={1}>This page could not be reached.</Heading>
        <Text as="p" display="block" type="supporting" className="mt-4">
          Check your connection and try again.
        </Text>
        <Button
          label="Try again"
          variant="primary"
          clickAction={() => {
            void query.refetch();
          }}
          className="mt-6 min-h-11 press"
        />
      </main>
    );
  }

  return (
    <main className="reveal-in mx-auto w-full max-w-2xl px-4 py-16 font-ui">
      <div aria-hidden="true" className="mb-6">
        <Mark size={28} />
      </div>
      <SharedCardScreen card={query.data} />
    </main>
  );
}

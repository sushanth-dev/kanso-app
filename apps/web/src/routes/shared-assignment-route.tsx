import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ApiRequestError } from '../api/account-api.ts';
import { sharedAssignmentApi, type SharedAssignment } from '../api/assignment-api.ts';
import { meQueryOptions } from '../query-client.ts';
import { Mark } from '../components/mark.tsx';

export function SharedAssignmentScreen({ assignment }: { assignment: SharedAssignment }) {
  useEffect(() => {
    document.title = `${assignment.focusTitle} · Kanso Chess`;
    return () => {
      document.title = 'Kanso Chess';
    };
  }, [assignment.focusTitle]);

  return (
    <>
      <Text as="p" display="block" type="supporting" className="text-sm">
        A focus assignment
      </Text>
      <Heading level={1}>{assignment.focusTitle}</Heading>
      <Text as="p" display="block" type="supporting" className="mt-2">
        {assignment.focusDescription}
      </Text>
      <section className="mt-8">
        <Text as="p" display="block" type="supporting" className="text-sm">
          The coach's instruction
        </Text>
        <blockquote className="mt-1 whitespace-pre-wrap font-display text-xl leading-snug">
          {assignment.instruction}
        </blockquote>
      </section>
    </>
  );
}

/**
 * ST-117. The one confirm action. The link can be opened by anyone holding it;
 * accepting needs the player's session, so this section asks /me first and
 * offers the honest alternative when there is none, or the tier is not there.
 */
function ConfirmSection({ token }: { token: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useQuery(meQueryOptions());
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setConfirming(true);
    setError(null);
    try {
      await sharedAssignmentApi.confirm(token);
      await queryClient.invalidateQueries({ queryKey: ['focus'] });
      await navigate({ to: '/focus', search: { stream: 'tournament' } });
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        setError('This link is no longer available.');
      } else if (err instanceof ApiRequestError && err.status === 403) {
        setError('Confirming a focus is part of the paid loop.');
      } else {
        setError('The assignment could not be accepted. Please try again.');
      }
      setConfirming(false);
    }
  }

  if (me.isPending) {
    return null;
  }

  if (me.isError) {
    if (me.error instanceof ApiRequestError && me.error.code === 'consent_required') {
      return (
        <section className="mt-10 space-y-3">
          <Text as="p" display="block">
            A guardian must confirm consent before this focus can be accepted.
          </Text>
          <Button label="Guardian consent" href="/guardians/waiting" variant="secondary" />
        </section>
      );
    }
    // Signed out: the link pre-fills, signing in sets it.
    return (
      <section className="mt-10 space-y-3">
        <Text as="p" display="block">
          Sign in to accept this focus as your own.
        </Text>
        <Button label="Sign in to accept" href="/sign-in" variant="primary" className="press" />
      </section>
    );
  }

  if (error !== null) {
    return (
      <section className="mt-10 space-y-3">
        <Text as="p" display="block" type="supporting" role="alert">
          {error}
        </Text>
        {error.startsWith('This link is no longer available') ? null : (
          <Button
            label={confirming ? 'Accepting...' : 'Try again'}
            variant="secondary"
            onClick={() => {
              void handleConfirm();
            }}
            isDisabled={confirming}
            className="press"
          />
        )}
      </section>
    );
  }

  return (
    <section className="mt-10">
      <Button
        label={confirming ? 'Accepting...' : 'Accept this focus'}
        variant="primary"
        onClick={() => {
          void handleConfirm();
        }}
        isDisabled={confirming}
        className="min-h-11 press"
      />
      <Text as="p" display="block" type="supporting" className="mt-2 text-sm">
        Accepting sets this as your active focus, with the coach's instruction recorded. Your
        current focus, if you have one, ends.
      </Text>
    </section>
  );
}

export function SharedAssignmentRoute() {
  const { token } = useParams({ from: '/shared/assignments/$token' });
  const query = useQuery({
    queryKey: ['shared-assignment', token],
    queryFn: () => sharedAssignmentApi.getShared(token),
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
  if (query.isError && query.error instanceof ApiRequestError && query.error.status === 404) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-16 font-ui">
        <Heading level={1}>This link is no longer available.</Heading>
      </main>
    );
  }

  // A fetch that never reached the server (a network failure or a 5xx) is a
  // different state from a dead link: the reader may still be able to reach
  // the page, so offer a retry rather than a dead end.
  if (query.isError) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-16 font-ui">
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
          className="mt-6 press"
        />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16 font-ui">
      <div aria-hidden="true" className="mb-6">
        <Mark size={28} />
      </div>
      <SharedAssignmentScreen assignment={query.data} />
      <ConfirmSection token={token} />
    </main>
  );
}

import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { nudgeApi } from '../api/nudge-api.ts';

export function NudgeUnsubscribeRoute() {
  const { token } = useParams({ from: '/nudge/unsubscribe/$token' });
  const query = useQuery({
    queryKey: ['nudge-unsubscribe', token],
    queryFn: async () => {
      await nudgeApi.unsubscribe(token);
      // The endpoint is a 204 with no body; React Query rejects a queryFn that
      // resolves undefined, so the query turns "no throw" into a real value.
      return true;
    },
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

  // Tampered, expired, and unknown links are the API's one indistinguishable 404;
  // the page says the same thing for all of them rather than naming which case.
  if (query.isError) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-16 font-ui">
        <Heading level={1}>This link is no longer available.</Heading>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16 font-ui">
      <Heading level={1}>You are unsubscribed</Heading>
      <Text as="p" display="block" type="supporting" className="mt-4">
        One link stops these emails, and this was it. The nudge will not reach this address again;
        everything else in the app is unchanged.
      </Text>
    </main>
  );
}

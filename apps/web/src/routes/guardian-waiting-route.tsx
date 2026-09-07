import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { authClient } from '../auth-client.ts';
import { ME_QUERY_KEY } from '../query-client.ts';
import { StatusMessage } from '../components/status-message.tsx';

export function GuardianWaitingScreen({ signOut }: { signOut: () => Promise<void> }) {
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function handleSignOut() {
    setSignOutError(null);
    try {
      await signOut();
    } catch {
      setSignOutError('Sign out failed.');
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16 font-ui">
      <Card className="reveal-in mx-auto w-full max-w-sm">
        <Heading level={1}>Waiting for guardian consent</Heading>
        <Text as="p" display="block" type="supporting" className="mt-4">
          A guardian has been emailed and must confirm by opening the link before this account can
          be used.
        </Text>
        {signOutError !== null ? (
          <div className="mt-4">
            <StatusMessage tone="error">{signOutError}</StatusMessage>
          </div>
        ) : null}
        <Button
          label="Sign out"
          variant="secondary"
          clickAction={handleSignOut}
          className="mt-6 press"
        />
      </Card>
    </main>
  );
}

export function GuardianWaitingRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const signOut = async () => {
    const { error } = await authClient.signOut();
    if (error !== null) throw new Error('Sign out failed.');
    queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
    await navigate({ to: '/sign-in' });
  };

  return <GuardianWaitingScreen signOut={signOut} />;
}

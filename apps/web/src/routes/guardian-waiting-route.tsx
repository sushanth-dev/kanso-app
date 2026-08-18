import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
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
      <Heading level={1}>Waiting for guardian consent</Heading>
      <p className="mt-4 text-muted">
        A guardian has been emailed and must confirm by opening the link before this account can be
        used.
      </p>
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

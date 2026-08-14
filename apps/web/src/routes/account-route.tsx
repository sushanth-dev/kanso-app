import { useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { authClient } from '../auth-client.ts';
import type { Me, Player } from '../api/account-api.ts';
import { ME_QUERY_KEY, meQueryOptions } from '../query-client.ts';
import { StatusMessage } from '../components/status-message.tsx';

export interface AccountScreenProps {
  me: Me;
  signOut: () => Promise<void>;
  clearAccount: () => void;
}

function OwnedPlayerCard({ player }: { player: Player }) {
  return (
    <li>
      <Card>
        <Heading level={3}>Owned {player.displayName}</Heading>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            href={`/account/players/${player.id}/edit`}
            label="Edit"
            variant="secondary"
            size="sm"
          />
          <Button
            href={`/account/players/${player.id}/guardian`}
            label="Add guardian"
            variant="secondary"
            size="sm"
          />
        </div>
      </Card>
    </li>
  );
}

function GuardedPlayerCard({ player }: { player: Player }) {
  return (
    <li>
      <Card>
        <Heading level={3}>Guarded {player.displayName}</Heading>
      </Card>
    </li>
  );
}

export function AccountScreen({ me, signOut, clearAccount }: AccountScreenProps) {
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function handleSignOut() {
    setSignOutError(null);
    try {
      await signOut();
      clearAccount();
    } catch {
      setSignOutError('Sign out failed. Please try again.');
    }
  }

  return (
    <>
      <section aria-labelledby="account-heading" className="space-y-3">
        <Heading level={1} id="account-heading">
          Your account
        </Heading>
        <p>{me.name}</p>
        <p className="text-muted">{me.email}</p>
        <Badge label={me.tier === 'paid' ? 'Paid' : 'Free'} variant="neutral" />
        {signOutError !== null ? <StatusMessage tone="error">{signOutError}</StatusMessage> : null}
        <Button label="Sign out" variant="secondary" clickAction={handleSignOut} />
      </section>

      <section aria-labelledby="owned-heading" className="mt-8">
        <Heading level={2} id="owned-heading">
          Your players
        </Heading>
        {me.players.length === 0 ? (
          <EmptyState
            title="No players yet"
            description="Create a player to start tracking their games."
            headingLevel={3}
          />
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {me.players.map((player) => (
              <OwnedPlayerCard key={player.id} player={player} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="guarded-heading" className="mt-8">
        <Heading level={2} id="guarded-heading">
          Players you support
        </Heading>
        {me.guardedPlayers.length === 0 ? (
          <EmptyState
            title="No players you support"
            description="Players you pay for will show up here."
            headingLevel={3}
          />
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {me.guardedPlayers.map((player) => (
              <GuardedPlayerCard key={player.id} player={player} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export function AccountRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me } = useSuspenseQuery(meQueryOptions());

  const clearAccount = () => {
    queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
  };

  const signOut = async () => {
    await authClient.signOut();
    clearAccount();
    await navigate({ to: '/sign-in' });
  };

  return <AccountScreen me={me} signOut={signOut} clearAccount={clearAccount} />;
}

import { useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { authClient } from '../auth-client.ts';
import type { Me, Player } from '../api/account-api.ts';
import { ME_QUERY_KEY, meQueryOptions } from '../query-client.ts';
import { StatusMessage } from '../components/status-message.tsx';

export interface AccountScreenProps {
  me: Me;
  signOut: () => Promise<void>;
}

function PlayerCard({ player, prefix }: { player: Player; prefix: 'Owned' | 'Guarded' }) {
  return (
    <li>
      <Card>
        <Heading level={3}>
          {prefix} {player.displayName}
        </Heading>
        {prefix === 'Owned' ? (
          <div className="mt-3 flex flex-wrap gap-4">
            <Link
              to="/account/players/$playerId/edit"
              params={{ playerId: player.id }}
              className="inline-flex min-h-11 min-w-11 items-center justify-center font-ui text-sm text-accent underline transition-control"
            >
              Edit
            </Link>
            <Link
              to="/account/players/$playerId/guardian"
              params={{ playerId: player.id }}
              className="inline-flex min-h-11 items-center font-ui text-sm text-accent underline transition-control"
            >
              Add guardian
            </Link>
          </div>
        ) : null}
      </Card>
    </li>
  );
}

export function AccountScreen({ me, signOut }: AccountScreenProps) {
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
    <>
      <section aria-labelledby="account-heading" className="space-y-3">
        <Heading level={1} id="account-heading">
          Your account
        </Heading>
        <p className="font-display text-lg leading-tight">{me.name}</p>
        <p className="text-muted">{me.email}</p>
        <Badge label={me.tier === 'paid' ? 'Paid' : 'Free'} variant="neutral" />
        {signOutError !== null ? <StatusMessage tone="error">{signOutError}</StatusMessage> : null}
        <Button label="Sign out" variant="secondary" clickAction={handleSignOut} />
      </section>

      <section aria-labelledby="owned-heading" className="mt-8">
        <Heading level={2} id="owned-heading">
          Your players
        </Heading>
        <Link
          to="/account/players/new"
          className="mt-3 inline-flex min-h-11 items-center rounded-control bg-accent px-4 py-2 font-ui text-on-accent transition-control hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-focus"
        >
          Create player
        </Link>
        {me.players.length === 0 ? (
          <EmptyState
            title="No players yet"
            description="Create a player to start tracking their games."
            headingLevel={3}
          />
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {me.players.map((player) => (
              <PlayerCard key={player.id} player={player} prefix="Owned" />
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
              <PlayerCard key={player.id} player={player} prefix="Guarded" />
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

  const signOut = async () => {
    const { error } = await authClient.signOut();
    if (error !== null) throw new Error('Sign out failed.');
    queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
    await navigate({ to: '/sign-in' });
  };

  return <AccountScreen me={me} signOut={signOut} />;
}

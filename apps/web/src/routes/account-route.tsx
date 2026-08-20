import { useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { authClient } from '../auth-client.ts';
import { ApiRequestError, type Me, type Player } from '../api/account-api.ts';
import {
  ME_QUERY_KEY,
  gamesQueryOptions,
  meQueryOptions,
  reportQueryOptions,
} from '../query-client.ts';
import { StatusMessage } from '../components/status-message.tsx';
import { ChangePasswordForm } from '../components/change-password-form.tsx';

export interface AccountScreenProps {
  me: Me;
  signOut: () => Promise<void>;
}

export type PlayerDiagnosisState =
  | { kind: 'pending' }
  | { kind: 'diagnosis'; topWeakness: string; gamesCovered: number }
  | { kind: 'honest-empty' }
  | { kind: 'still-analyzing' }
  | { kind: 'no-diagnosis' }
  | { kind: 'unavailable' };

export function usePlayerDiagnosisState(playerId: string): PlayerDiagnosisState {
  const reportQuery = useQuery(reportQueryOptions(playerId, 'tournament'));
  const gamesQuery = useQuery({
    ...gamesQueryOptions(playerId, 'tournament'),
    enabled:
      reportQuery.isError &&
      reportQuery.error instanceof ApiRequestError &&
      reportQuery.error.status === 404,
  });

  if (reportQuery.isPending) return { kind: 'pending' };

  if (reportQuery.isSuccess) {
    const topWeakness = reportQuery.data.weaknesses[0];
    if (topWeakness !== undefined) {
      return {
        kind: 'diagnosis',
        topWeakness: topWeakness.label,
        gamesCovered: reportQuery.data.gamesCovered,
      };
    }
    return { kind: 'honest-empty' };
  }

  if (reportQuery.error instanceof ApiRequestError && reportQuery.error.status === 404) {
    if (gamesQuery.isPending) return { kind: 'pending' };
    const games = gamesQuery.data;
    const stillAnalyzing =
      games !== undefined &&
      games.games.some(
        (game) =>
          game.analysisStatus === 'pending' ||
          game.analysisStatus === 'queued' ||
          game.analysisStatus === 'analyzing',
      );
    return stillAnalyzing ? { kind: 'still-analyzing' } : { kind: 'no-diagnosis' };
  }

  return { kind: 'unavailable' };
}

export function PlayerDiagnosis({ state }: { state: PlayerDiagnosisState }) {
  switch (state.kind) {
    case 'pending':
      return (
        <div role="status" aria-label="Loading diagnosis" aria-busy="true" className="mt-2">
          <div className="h-4 w-48 rounded-control bg-sunken" />
          <div className="mt-1 h-3 w-32 rounded-control bg-sunken" />
        </div>
      );
    case 'diagnosis':
      return (
        <>
          <p className="mt-2 text-muted">
            Top weakness: <span className="text-primary">{state.topWeakness}</span>
          </p>
          <p className="mt-1 font-mono text-sm text-muted">{state.gamesCovered} tournament games</p>
        </>
      );
    case 'honest-empty':
      return (
        <p className="mt-2 text-sm text-muted">Could not identify a defensible weakness yet.</p>
      );
    case 'still-analyzing':
      return (
        <p className="mt-2 text-sm text-muted">
          Analysis in progress. Come back in a couple of minutes.
        </p>
      );
    case 'no-diagnosis':
      return (
        <p className="mt-2 text-sm text-muted">
          No diagnosis yet. Import games to get a ranked report.
        </p>
      );
    case 'unavailable':
      return <p className="mt-2 text-sm text-muted">Diagnosis unavailable right now.</p>;
  }
}

export function PlayerCard({ player, state }: { player: Player; state: PlayerDiagnosisState }) {
  return (
    <li>
      <Card>
        <Heading level={3}>{player.displayName}</Heading>
        <PlayerDiagnosis state={state} />
        <div className="mt-3 flex flex-wrap gap-4">
          <Link
            to="/account/players/$playerId/report"
            params={{ playerId: player.id }}
            search={{ stream: 'tournament' }}
            className="inline-flex min-h-11 items-center font-ui text-sm text-accent underline press"
          >
            View report
          </Link>
          <Link
            to="/account/players/$playerId/import"
            params={{ playerId: player.id }}
            className="inline-flex min-h-11 items-center font-ui text-sm text-accent underline press"
          >
            Import games
          </Link>
          <Link
            to="/account/players/$playerId/focus"
            params={{ playerId: player.id }}
            search={{ stream: 'tournament' }}
            className="inline-flex min-h-11 items-center font-ui text-sm text-accent underline press"
          >
            Set focus
          </Link>
          <Link
            to="/account/players/$playerId/games"
            params={{ playerId: player.id }}
            search={{ stream: 'tournament' }}
            className="inline-flex min-h-11 items-center font-ui text-sm text-accent underline press"
          >
            Review games
          </Link>
          <Link
            to="/account/players/$playerId/edit"
            params={{ playerId: player.id }}
            className="inline-flex min-h-11 min-w-11 items-center justify-center font-ui text-sm text-accent underline press"
          >
            Edit
          </Link>
        </div>
      </Card>
    </li>
  );
}

export function PlayerCardWithDiagnosis({ player }: { player: Player }) {
  const state = usePlayerDiagnosisState(player.id);
  return <PlayerCard player={player} state={state} />;
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
        <Button
          label="Sign out"
          variant="secondary"
          clickAction={handleSignOut}
          className="press"
        />
      </section>

      <ChangePasswordForm />

      <section aria-labelledby="owned-heading" className="mt-8">
        <Heading level={2} id="owned-heading">
          Your players
        </Heading>
        <Link
          to="/account/players/new"
          className="mt-3 inline-flex min-h-11 items-center rounded-control bg-accent px-4 py-2 font-ui text-on-accent press hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
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
              <PlayerCardWithDiagnosis key={player.id} player={player} />
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
    // Navigate first, then clear: removing `/me` while this route is still
    // mounted suspends it and re-fetches with the session already cleared,
    // which surfaces a spurious 401.
    await navigate({ to: '/sign-in' });
    queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
  };

  return <AccountScreen me={me} signOut={signOut} />;
}

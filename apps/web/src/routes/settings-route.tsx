import { useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ApiRequestError, type Me, type Player } from '../api/account-api.ts';
import { authClient } from '../auth-client.ts';
import { ChangePasswordForm } from '../components/change-password-form.tsx';
import { StatusMessage } from '../components/status-message.tsx';
import {
  gamesQueryOptions,
  ME_QUERY_KEY,
  meQueryOptions,
  reportQueryOptions,
} from '../query-client.ts';

export interface SettingsScreenProps {
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

export function usePlayerDiagnosisState(): PlayerDiagnosisState {
  const reportQuery = useQuery(reportQueryOptions('tournament'));
  const gamesQuery = useQuery({
    ...gamesQueryOptions('tournament'),
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
          <Text as="p" display="block" type="supporting" className="mt-2">
            Top weakness: <Text>{state.topWeakness}</Text>
          </Text>
          <Text as="p" display="block" type="supporting" className="mt-1 font-mono text-sm">
            {state.gamesCovered} tournament games
          </Text>
        </>
      );
    case 'honest-empty':
      return (
        <Text as="p" display="block" type="supporting" className="mt-2 text-sm">
          Could not identify a defensible weakness yet.
        </Text>
      );
    case 'still-analyzing':
      return (
        <Text as="p" display="block" type="supporting" className="mt-2 text-sm">
          Analysis in progress. Come back in a couple of minutes.
        </Text>
      );
    case 'no-diagnosis':
      return (
        <Text as="p" display="block" type="supporting" className="mt-2 text-sm">
          No diagnosis yet. Import games to get a ranked report.
        </Text>
      );
    case 'unavailable':
      return (
        <Text as="p" display="block" type="supporting" className="mt-2 text-sm">
          Diagnosis unavailable right now.
        </Text>
      );
  }
}

export function PlayerCard({ player, state }: { player: Player; state: PlayerDiagnosisState }) {
  return (
    <li>
      <Card>
        <Heading level={2}>{player.displayName}</Heading>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge label={`${player.currentStreak}-day streak`} variant="orange" />
          <Badge label={`Level ${player.level}`} variant="info" />
        </div>
        <PlayerDiagnosis state={state} />
        <div className="mt-3 flex flex-wrap gap-4">
          <Link href="/account/report?stream=tournament">View report</Link>
          <Link href="/account/import">Import games</Link>
          <Link href="/account/focus?stream=tournament">Set focus</Link>
          <Link href="/account/proof-sheet">Share proof sheet</Link>
          <Link href="/account/games?stream=tournament">Review games</Link>
          <Link href="/account/player">Edit</Link>
        </div>
      </Card>
    </li>
  );
}

export function PlayerCardWithDiagnosis({ player }: { player: Player }) {
  const state = usePlayerDiagnosisState();
  return <PlayerCard player={player} state={state} />;
}

export function SettingsScreen({ me, signOut }: SettingsScreenProps) {
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
        <Text as="p" display="block" className="font-display text-lg leading-tight">
          {me.name}
        </Text>
      </section>

      <section aria-label="Your player" className="mt-8">
        <ul className="grid grid-cols-1 gap-4">
          <PlayerCardWithDiagnosis player={me.player} />
        </ul>
      </section>

      <section aria-labelledby="account-details-heading" className="mt-8">
        <Heading level={2} id="account-details-heading">
          Account details
        </Heading>
        <Text as="p" display="block" type="supporting">
          {me.email}
        </Text>
        <div>
          <Button label="See plans" href="/account/upgrade" variant="primary" className="mt-3" />
        </div>
      </section>

      <section aria-labelledby="signout-heading" className="mt-8">
        <Heading level={2} id="signout-heading">
          Sign out
        </Heading>
        {signOutError !== null ? (
          <div className="mt-3">
            <StatusMessage tone="error">{signOutError}</StatusMessage>
          </div>
        ) : null}
        <Button
          label="Sign out"
          variant="secondary"
          clickAction={handleSignOut}
          className="mt-3 press"
        />
      </section>

      <ChangePasswordForm />
    </>
  );
}

export function SettingsRoute() {
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

  return <SettingsScreen me={me} signOut={signOut} />;
}

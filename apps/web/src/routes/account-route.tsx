import { Badge } from '@astryxdesign/core/Badge';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ApiRequestError, type Me, type Player } from '../api/account-api.ts';
import { gamesQueryOptions, meQueryOptions, reportQueryOptions } from '../query-client.ts';

export interface AccountScreenProps {
  me: Me;
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
        <Heading level={2}>{player.displayName}</Heading>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge label={`${player.currentStreak}-day streak`} variant="orange" />
          <Badge label={`Level ${player.level}`} variant="info" />
        </div>
        <PlayerDiagnosis state={state} />
        <div className="mt-3 flex flex-wrap gap-4">
          <Link
            to="/account/report"
            search={{ stream: 'tournament' }}
            className="inline-flex min-h-11 items-center font-ui text-sm text-accent underline press"
          >
            View report
          </Link>
          <Link
            to="/account/import"
            className="inline-flex min-h-11 items-center font-ui text-sm text-accent underline press"
          >
            Import games
          </Link>
          <Link
            to="/account/focus"
            search={{ stream: 'tournament' }}
            className="inline-flex min-h-11 items-center font-ui text-sm text-accent underline press"
          >
            Set focus
          </Link>
          <Link
            to="/account/proof-sheet"
            className="inline-flex min-h-11 items-center font-ui text-sm text-accent underline press"
          >
            Share proof sheet
          </Link>
          <Link
            to="/account/games"
            search={{ stream: 'tournament' }}
            className="inline-flex min-h-11 items-center font-ui text-sm text-accent underline press"
          >
            Review games
          </Link>
          <Link
            to="/account/player"
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
  const state = usePlayerDiagnosisState();
  return <PlayerCard player={player} state={state} />;
}

export function AccountScreen({ me }: AccountScreenProps) {
  return (
    <>
      <section aria-labelledby="account-heading" className="space-y-3">
        <Heading level={1} id="account-heading">
          Your account
        </Heading>
        <p className="font-display text-lg leading-tight">{me.name}</p>
      </section>

      <section aria-label="Your player" className="mt-8">
        <ul className="grid grid-cols-1 gap-4">
          <PlayerCardWithDiagnosis player={me.player} />
        </ul>
      </section>
    </>
  );
}

export function AccountRoute() {
  const { data: me } = useSuspenseQuery(meQueryOptions());
  return <AccountScreen me={me} />;
}

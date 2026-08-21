import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Heading } from '@astryxdesign/core/Heading';
import { useQueryClient, useSuspenseQuery, type QueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ApiRequestError, type Me } from '../api/account-api.ts';
import type { Stream } from '../api/diagnosis-api.ts';
import type { ImportApi, ImportJob, ImportSource, StartImportBody } from '../api/import-api.ts';
import {
  importApi,
  isPlausibleChesscomUsername,
  isPlausibleLichessUsername,
} from '../api/import-api.ts';
import { secondaryLinkClassName } from '../components/secondary-link.ts';
import { StatusMessage, type StatusTone } from '../components/status-message.tsx';
import { StreamToggle } from '../components/stream-toggle.tsx';
import { TextInput } from '../components/text-input.tsx';
import { ME_QUERY_KEY, meQueryOptions } from '../query-client.ts';
import type { NavigateTo } from './auth-routes.tsx';
import { track } from '../analytics.ts';

const METHOD_OPTIONS: ReadonlyArray<{ value: ImportSource; label: string }> = [
  { value: 'chesscom', label: 'Chess.com username' },
  { value: 'lichess', label: 'Lichess username' },
  { value: 'pgn_upload', label: 'PGN upload' },
  { value: 'uscf', label: 'Tournament by name' },
];

const PROVIDER_LABEL: Record<ImportSource, string> = {
  chesscom: 'Chess.com',
  lichess: 'Lichess',
  // pgn_upload never reaches the provider, so its label is never shown.
  pgn_upload: 'PGN upload',
  uscf: 'USCF',
};

const selectClassName =
  'min-h-11 w-full rounded-control border border-border-strong bg-raised px-3 py-2 text-primary transition-control focus:border-focus focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

type ImportOutcome =
  | { kind: 'imported'; job: ImportJob }
  | { kind: 'none-found'; method: ImportSource; label: string; tournamentName: string }
  | { kind: 'nothing-new'; found: number }
  | { kind: 'username-not-found'; source: 'chesscom' | 'lichess' }
  | { kind: 'provider-error'; provider: string }
  | { kind: 'tournament-not-found'; tournamentName: string }
  | { kind: 'name-mismatch'; detail: string }
  | { kind: 'invalid-pgn'; issues: Array<{ path: string; message: string }> }
  | { kind: 'daily-cap'; message: string };

function gamesLabel(count: number): string {
  return count === 1 ? 'game' : 'games';
}

function outcomeForJob(
  job: ImportJob,
  method: ImportSource,
  label: string,
  tournamentName: string,
): ImportOutcome {
  if (job.gamesImported > 0) return { kind: 'imported', job };
  if (job.gamesFound === 0) return { kind: 'none-found', method, label, tournamentName };
  return { kind: 'nothing-new', found: job.gamesFound };
}

function outcomeStatus(outcome: ImportOutcome): { tone: StatusTone; message: string } {
  switch (outcome.kind) {
    case 'imported': {
      const imported = `Imported ${outcome.job.gamesImported} ${gamesLabel(outcome.job.gamesImported)}.`;
      const rejected =
        outcome.job.gamesRejected > 0
          ? ` ${outcome.job.gamesRejected} ${gamesLabel(outcome.job.gamesRejected)} ${outcome.job.gamesRejected === 1 ? 'was' : 'were'} rejected and not imported.`
          : '';
      return { tone: 'success', message: imported + rejected };
    }
    case 'none-found':
      return {
        tone: 'info',
        message:
          outcome.method === 'uscf'
            ? `No games found for ${outcome.label} in ${outcome.tournamentName}.`
            : `No games found for ${outcome.label} in the last 12 months.`,
      };
    case 'nothing-new':
      return {
        tone: 'info',
        message: `Nothing new to import; all ${outcome.found} ${gamesLabel(outcome.found)} ${outcome.found === 1 ? 'was' : 'were'} already in this account.`,
      };
    case 'username-not-found':
      return {
        tone: 'error',
        message: `No ${PROVIDER_LABEL[outcome.source]} account by that username.`,
      };
    case 'provider-error':
      return {
        tone: 'error',
        message: `${outcome.provider} is unreachable; try again later.`,
      };
    case 'tournament-not-found':
      return {
        tone: 'error',
        message: `No USCF tournament found by the name "${outcome.tournamentName}".`,
      };
    case 'name-mismatch':
      return { tone: 'error', message: outcome.detail };
    case 'invalid-pgn':
      return { tone: 'error', message: 'The upload contains a game that could not be parsed.' };
    case 'daily-cap':
      return { tone: 'error', message: outcome.message };
  }
}

function renderOutcome(outcome: ImportOutcome): ReactNode {
  const status = outcomeStatus(outcome);
  return (
    <div className="mt-4">
      <StatusMessage tone={status.tone}>{status.message}</StatusMessage>
      {outcome.kind === 'imported' &&
        (outcome.job.source === 'uscf' ? (
          <p className="mt-2 text-sm text-muted">
            These games carry results, not moves, so no analysis follows.
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">
            Analysis runs next and arrives asynchronously.{' '}
            <Link
              to="/account/report"
              search={{ stream: outcome.job.stream }}
              className="font-ui text-sm text-accent underline"
            >
              View report
            </Link>
          </p>
        ))}
      {outcome.kind === 'invalid-pgn' && (
        <ul className="mt-2 list-disc pl-5 text-sm text-danger">
          {outcome.issues.map((issue) => (
            <li key={issue.path}>
              {issue.path}: {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface ImportScreenProps {
  me: Me;
  importApi: ImportApi;
  queryClient: QueryClient;
  navigate: NavigateTo;
}

export function ImportScreen({ me, importApi, queryClient, navigate }: ImportScreenProps) {
  const player = me.player;

  const [method, setMethod] = useState<ImportSource>('chesscom');
  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState<string | undefined>(undefined);
  const [pgn, setPgn] = useState<string | null>(null);
  const [pgnError, setPgnError] = useState<string | undefined>(undefined);
  const [stream, setStream] = useState<Stream>('online');
  const [tournamentName, setTournamentName] = useState('');
  const [tournamentError, setTournamentError] = useState<string | undefined>(undefined);
  const [playerName, setPlayerName] = useState(player.displayName);
  const [playerNameError, setPlayerNameError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function clearFieldErrors() {
    setUsernameError(undefined);
    setPgnError(undefined);
    setTournamentError(undefined);
    setPlayerNameError(undefined);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOutcome(null);
    setFormError(null);
    clearFieldErrors();

    let body: StartImportBody;
    if (method === 'chesscom' || method === 'lichess') {
      const trimmed = username.trim();
      const plausible =
        method === 'chesscom'
          ? isPlausibleChesscomUsername(trimmed)
          : isPlausibleLichessUsername(trimmed);
      if (!plausible) {
        setUsernameError(`Enter a valid ${PROVIDER_LABEL[method]} username.`);
        return;
      }
      body = { source: method, username: trimmed };
    } else if (method === 'pgn_upload') {
      if (pgn === null || pgn.trim() === '') {
        setPgnError('Choose a PGN file.');
        return;
      }
      body = { source: 'pgn_upload', pgn, stream };
    } else {
      const trimmedTournament = tournamentName.trim();
      const trimmedPlayer = playerName.trim();
      if (trimmedTournament === '') {
        setTournamentError('Enter the tournament name.');
        return;
      }
      if (trimmedPlayer === '') {
        setPlayerNameError('Enter the player name.');
        return;
      }
      body = { source: 'uscf', tournamentName: trimmedTournament, playerName: trimmedPlayer };
    }

    setSubmitting(true);
    try {
      const job = await importApi.startImport(body);
      const label =
        body.source === 'uscf'
          ? body.playerName
          : body.source === 'pgn_upload'
            ? ''
            : body.username;
      const noneFoundTournament = body.source === 'uscf' ? body.tournamentName : '';
      const nextOutcome = outcomeForJob(job, body.source, label, noneFoundTournament);
      setOutcome(nextOutcome);
      if (nextOutcome.kind === 'imported') {
        track('game_imported', {
          source: job.source,
          gamesFound: job.gamesFound,
          gamesImported: job.gamesImported,
        });
      }
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.status === 401) {
          queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
          await navigate({ to: '/sign-in' });
          return;
        }
        if (error.status === 403) {
          setFormError('This player cannot be imported from this account.');
          return;
        }
        if (error.code === 'invalid_pgn') {
          setOutcome({ kind: 'invalid-pgn', issues: error.issues ?? [] });
          return;
        }
        if (error.code === 'daily_import_cap') {
          setOutcome({ kind: 'daily-cap', message: error.message });
          return;
        }
        if (error.code === 'username_not_found') {
          setOutcome({
            kind: 'username-not-found',
            source: method === 'lichess' ? 'lichess' : 'chesscom',
          });
          return;
        }
        if (error.code === 'tournament_not_found') {
          setOutcome({ kind: 'tournament-not-found', tournamentName: tournamentName.trim() });
          return;
        }
        if (error.code === 'name_mismatch') {
          setOutcome({ kind: 'name-mismatch', detail: error.message });
          return;
        }
        if (error.code === 'upstream_error') {
          setOutcome({ kind: 'provider-error', provider: PROVIDER_LABEL[method] });
          return;
        }
      }
      setFormError('The import failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const waitingMessage =
    method === 'chesscom' || method === 'lichess'
      ? `Importing ${player.displayName}'s season... this usually takes about a minute.`
      : method === 'pgn_upload'
        ? 'Importing the uploaded games... usually a few seconds.'
        : 'Importing the tournament crosstable... usually a few seconds.';

  return (
    <Card>
      <Heading level={1}>Import games</Heading>
      <p className="mt-1 text-muted">for {player.displayName}</p>

      {submitting ? (
        <div className="mt-4">
          <StatusMessage tone="info">{waitingMessage}</StatusMessage>
        </div>
      ) : outcome !== null ? (
        renderOutcome(outcome)
      ) : formError !== null ? (
        <div className="mt-4">
          <StatusMessage tone="error">{formError}</StatusMessage>
        </div>
      ) : null}

      <form
        className="mt-4"
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <FormLayout>
          <Field label="Method" inputID="method">
            <select
              id="method"
              name="method"
              value={method}
              onChange={(event) => {
                setMethod(event.target.value as ImportSource);
                clearFieldErrors();
              }}
              className={selectClassName}
            >
              {METHOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          {method === 'chesscom' || method === 'lichess' ? (
            <>
              <Field
                label="Username"
                inputID="username"
                status={
                  usernameError === undefined
                    ? undefined
                    : { type: 'error' as const, message: usernameError }
                }
              >
                <TextInput
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  maxLength={60}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  aria-invalid={usernameError === undefined ? undefined : true}
                  aria-describedby={usernameError === undefined ? undefined : 'username-status'}
                />
              </Field>
              <p className="text-muted">Imports the last 12 months of online games.</p>
            </>
          ) : method === 'pgn_upload' ? (
            <>
              <Field
                label="PGN file"
                inputID="pgn-file"
                status={
                  pgnError === undefined ? undefined : { type: 'error' as const, message: pgnError }
                }
              >
                <input
                  id="pgn-file"
                  name="pgn"
                  type="file"
                  accept=".pgn,text/plain"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    setPgnError(undefined);
                    if (file === undefined) {
                      setPgn(null);
                      return;
                    }
                    void file.text().then((text) => setPgn(text));
                  }}
                  aria-invalid={pgnError === undefined ? undefined : true}
                  aria-describedby={pgnError === undefined ? undefined : 'pgn-file-status'}
                />
              </Field>
              <StreamToggle
                stream={stream}
                onChange={setStream}
                ariaLabel="Where were these games played?"
              />
            </>
          ) : (
            <>
              <Field
                label="Tournament name"
                inputID="tournament-name"
                status={
                  tournamentError === undefined
                    ? undefined
                    : { type: 'error' as const, message: tournamentError }
                }
              >
                <TextInput
                  id="tournament-name"
                  name="tournamentName"
                  type="text"
                  value={tournamentName}
                  onChange={(event) => setTournamentName(event.target.value)}
                  aria-invalid={tournamentError === undefined ? undefined : true}
                  aria-describedby={
                    tournamentError === undefined ? undefined : 'tournament-name-status'
                  }
                />
              </Field>
              <Field
                label="Player name"
                inputID="player-name"
                status={
                  playerNameError === undefined
                    ? undefined
                    : { type: 'error' as const, message: playerNameError }
                }
              >
                <TextInput
                  id="player-name"
                  name="playerName"
                  type="text"
                  value={playerName}
                  onChange={(event) => setPlayerName(event.target.value)}
                  aria-invalid={playerNameError === undefined ? undefined : true}
                  aria-describedby={
                    playerNameError === undefined ? undefined : 'player-name-status'
                  }
                />
              </Field>
              <p className="text-muted">Imports tournament results, not moves.</p>
            </>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              type="submit"
              label={submitting ? 'Importing...' : 'Import games'}
              variant="primary"
              isDisabled={submitting}
              isLoading={submitting}
              className="min-h-11 flex-1 press"
            />
            <Link to="/account" className={secondaryLinkClassName}>
              Back to account
            </Link>
          </div>
        </FormLayout>
      </form>
    </Card>
  );
}

export function ImportRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me } = useSuspenseQuery(meQueryOptions());

  return (
    <ImportScreen me={me} importApi={importApi} queryClient={queryClient} navigate={navigate} />
  );
}

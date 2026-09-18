import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Field } from '@astryxdesign/core/Field';
import { FileInput } from '@astryxdesign/core/FileInput';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { useQueryClient, useSuspenseQuery, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { MIN_REPORT_GAMES } from '../analysis-status.ts';
import { ApiRequestError, type Me } from '../api/account-api.ts';
import type { ImportApi, ImportJob, ImportSource, StartImportBody } from '../api/import-api.ts';
import {
  importApi,
  isPlausibleChesscomUsername,
  isPlausibleLichessUsername,
} from '../api/import-api.ts';
import { StatusMessage, type StatusTone } from '../components/status-message.tsx';
import { TextInput } from '../components/text-input.tsx';
import { clearSessionState, meQueryOptions } from '../query-client.ts';
import type { NavigateTo } from './auth-routes.tsx';
import { track } from '../analytics.ts';

const METHOD_OPTIONS: ReadonlyArray<{ value: ImportSource; label: string }> = [
  { value: 'chesscom', label: 'Chess.com username' },
  { value: 'lichess', label: 'Lichess username' },
  { value: 'pgn_upload', label: 'PGN upload' },
];

const PROVIDER_LABEL: Record<ImportSource, string> = {
  chesscom: 'Chess.com',
  lichess: 'Lichess',
  // pgn_upload never reaches the provider, so its label is never shown.
  pgn_upload: 'PGN upload',
};

const selectClassName =
  'min-h-11 w-full rounded-control border border-border-strong bg-raised px-3 py-2 text-primary transition-control focus:border-focus focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

type ImportOutcome =
  | { kind: 'imported'; job: ImportJob }
  | { kind: 'none-found'; method: ImportSource; label: string }
  | { kind: 'nothing-new'; found: number }
  | { kind: 'username-not-found'; source: 'chesscom' | 'lichess' }
  | { kind: 'provider-error'; provider: string }
  | { kind: 'invalid-pgn'; issues: Array<{ path: string; message: string }> }
  | { kind: 'too-many-games'; message: string }
  | { kind: 'daily-cap'; message: string };

/** ST-115. The batch a tournament import hands to the debrief. */
interface DebriefBatch {
  gameIds: string[];
  tournamentId: string | null;
  gameId: string | null;
}

function gamesLabel(count: number): string {
  return count === 1 ? 'game' : 'games';
}

function outcomeForJob(job: ImportJob, method: ImportSource, label: string): ImportOutcome {
  if (job.gamesImported > 0) return { kind: 'imported', job };
  if (job.gamesFound === 0) return { kind: 'none-found', method, label };
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
      // ST-095: these games are stored but analysis will not start on its own.
      // The player names a side on each game review page; that is the queue.
      const undetermined =
        outcome.job.gamesUndetermined > 0
          ? ` ${outcome.job.gamesUndetermined} of them could not be tied to your side; open each under Games and pick the colour you played to start its analysis.`
          : '';
      return { tone: 'success', message: imported + rejected + undetermined };
    }
    case 'none-found':
      return {
        tone: 'info',
        message: `No games found for ${outcome.label} in the last 12 months.`,
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
    case 'invalid-pgn':
      return { tone: 'error', message: 'The upload contains a game that could not be parsed.' };
    case 'too-many-games':
      return { tone: 'error', message: outcome.message };
    case 'daily-cap':
      return { tone: 'error', message: outcome.message };
  }
}

function renderOutcome(outcome: ImportOutcome): ReactNode {
  const status = outcomeStatus(outcome);
  return (
    <div className="mt-4">
      <StatusMessage
        tone={status.tone}
        className={status.tone === 'success' ? 'pop-in' : undefined}
      >
        {status.message}
      </StatusMessage>
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
  const [username, setUsername] = useState(me.player.chesscomUsername ?? '');
  const [usernameError, setUsernameError] = useState<string | undefined>(undefined);
  const [pgn, setPgn] = useState<string | null>(null);
  const [pgnError, setPgnError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pgnFile, setPgnFile] = useState<File | null>(null);
  const [debrief, setDebrief] = useState<DebriefBatch | null>(null);

  function readPgnFile(file: File | null) {
    setPgnError(undefined);
    setPgnFile(file);
    if (file === null) {
      setPgn(null);
      return;
    }
    void file.text().then((text) => setPgn(text));
  }

  function clearFieldErrors() {
    setUsernameError(undefined);
    setPgnError(undefined);
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
    } else {
      if (pgn === null || pgn.trim() === '') {
        setPgnError('Choose a PGN file.');
        return;
      }
      // A PGN upload is always tournament games; a username import is always
      // online. The stream is fixed per method, not chosen.
      body = { source: 'pgn_upload', pgn, stream: 'tournament' };
    }

    setSubmitting(true);
    try {
      const job = await importApi.startImport(body);
      const label = body.source === 'pgn_upload' ? '' : body.username;
      const nextOutcome = outcomeForJob(job, body.source, label);
      setOutcome(nextOutcome);
      if (nextOutcome.kind === 'imported') {
        track('game_imported', {
          source: job.source,
          gamesFound: job.gamesFound,
          gamesImported: job.gamesImported,
        });
        // The report's games query may hold a stale empty cache from before
        // the import; drop it so the freshly imported games show as analysing.
        void queryClient.invalidateQueries({ queryKey: ['games'] });
        // ST-093: an import creates or grows tournaments; the tournament
        // queries hold 30s-stale caches that would hide the new rows.
        void queryClient.invalidateQueries({ queryKey: ['tournaments'] });
        void queryClient.invalidateQueries({ queryKey: ['tournament'] });
        void queryClient.invalidateQueries({ queryKey: ['round-decay'] });
        // ST-093: carry the batch's game ids so the analysing counter counts
        // this upload only, not every game already in the stream.
        // ST-115: a tournament batch ends in the debrief instead of a
        // navigation. gameId rides only when the old landing was the game
        // review (ST-096: under six games no report can generate), so the
        // debrief's skip lands where the import used to. Online imports
        // keep today's path and always go to the report.
        const firstGameId = job.gameIds[0];
        const underThreshold =
          job.stream === 'tournament' &&
          (job.tournament === null || job.tournament.gameCount < MIN_REPORT_GAMES);
        if (job.stream === 'tournament' && job.gameIds.length > 0) {
          setDebrief({
            gameIds: job.gameIds,
            tournamentId: job.tournament?.id ?? null,
            gameId: underThreshold && firstGameId !== undefined ? firstGameId : null,
          });
        } else if (underThreshold && firstGameId !== undefined) {
          await navigate({ to: '/games/$gameId', params: { gameId: firstGameId } });
        } else {
          await navigate({
            to: '/report',
            search: {
              stream: job.stream,
              gameIds: job.gameIds,
              ...(job.tournament !== null ? { tournamentId: job.tournament.id } : {}),
            },
          });
        }
      }
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.status === 401) {
          clearSessionState(queryClient);
          await navigate({ to: '/sign-in' });
          return;
        }
        if (error.status === 403) {
          setFormError('This player cannot be imported from this account.');
          return;
        }
        if (error.code === 'too_many_games') {
          setOutcome({ kind: 'too-many-games', message: error.message });
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
      : 'Importing the uploaded games... usually a few seconds.';

  return (
    <Card className="reveal-in">
      <Heading level={1}>Import games</Heading>
      <Text as="p" display="block" type="supporting" className="mt-1">
        for {player.displayName}
      </Text>

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

      {debrief !== null ? (
        <div className="mt-4 space-y-3">
          <Button
            label="Start the debrief"
            variant="primary"
            className="min-h-11 press"
            onClick={() => {
              void navigate({
                to: '/debrief',
                search: {
                  gameIds: debrief.gameIds,
                  ...(debrief.tournamentId !== null ? { tournamentId: debrief.tournamentId } : {}),
                  ...(debrief.gameId !== null ? { gameId: debrief.gameId } : {}),
                },
              });
            }}
          />
          <Text as="p" display="block" type="supporting">
            What happened, your one focus, and your first drill, in order.
          </Text>
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
                const next = event.target.value as ImportSource;
                setMethod(next);
                clearFieldErrors();
                if (next === 'chesscom') setUsername(me.player.chesscomUsername ?? '');
                if (next === 'lichess') setUsername(me.player.lichessUsername ?? '');
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
              <Text as="p" display="block" type="supporting">
                Imports the last 12 months of online games.
              </Text>
            </>
          ) : (
            <>
              <FileInput
                label="PGN file"
                mode="dropzone"
                accept=".pgn,text/plain"
                value={pgnFile}
                onChange={(files) => readPgnFile(Array.isArray(files) ? (files[0] ?? null) : files)}
                placeholder="Drop a PGN file here, or click to choose"
                status={
                  pgnError === undefined ? undefined : { type: 'error' as const, message: pgnError }
                }
              />
            </>
          )}

          <Button
            type="submit"
            label={submitting ? 'Importing...' : 'Import games'}
            variant="primary"
            isDisabled={submitting}
            isLoading={submitting}
            className="min-h-11 press"
          />
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

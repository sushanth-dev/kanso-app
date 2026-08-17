import { useState, type FormEvent } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Heading } from '@astryxdesign/core/Heading';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ApiRequestError } from '../api/account-api.ts';
import type { Stream } from '../api/diagnosis-api.ts';
import {
  focusApi,
  type ActiveFocus,
  type FocusCatalogueEntry,
  type FocusMeasurement,
  type FocusTrend,
  type SetFocus,
} from '../api/focus-api.ts';
import { proofSheetApi, type ProofSheet } from '../api/proof-sheet-api.ts';
import { secondaryLinkClassName } from '../components/secondary-link.ts';
import { StatusMessage } from '../components/status-message.tsx';
import { StreamToggle } from '../components/stream-toggle.tsx';
import {
  focusQueryOptions,
  focusesQueryOptions,
  ME_QUERY_KEY,
  proofSheetsQueryOptions,
  reportQueryOptions,
} from '../query-client.ts';

const STREAM_LABEL: Record<Stream, string> = {
  tournament: 'Tournament',
  online: 'Online',
};

const TREND_LABEL: Record<FocusTrend, string> = {
  improving: 'Improving',
  flat: 'Flat',
  declining: 'Declining',
  insufficient_evidence: 'Not enough evidence',
};

// The direction word carries the meaning; the glyph is the second channel, so a
// trend never reads as a color alone. Read hidden because the word is the text.
const TREND_ARROW: Record<Exclude<FocusTrend, 'insufficient_evidence'>, string> = {
  improving: '↑',
  flat: '→',
  declining: '↓',
};

// The one-stream focus says why. Precedent: TIME_TROUBLE_UNAVAILABLE in the
// report route, which keys an explanation rather than adding a data field.
const SINGLE_STREAM_NOTE: Record<string, string> = {
  time_management: 'Measured in online games only: tournament scoresheets do not carry clock data.',
};

const valueFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

const selectClassName =
  'min-h-11 w-full rounded-control border border-border-strong bg-raised px-3 py-2 text-primary transition-control focus:border-focus focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

const textareaClassName =
  'min-h-28 w-full resize-y rounded-control border border-border-strong bg-raised px-3 py-2 text-primary transition-control focus:border-focus focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

function formatValue(value: number | null): string {
  return value === null ? '—' : valueFormatter.format(value);
}

function measurableStreamsStatement(entry: FocusCatalogueEntry): string {
  if (entry.measurableStreams.length === 1) {
    const single = entry.measurableStreams[0];
    if (single === undefined) return 'Measured in no stream yet.';
    return SINGLE_STREAM_NOTE[entry.key] ?? `Measured in ${STREAM_LABEL[single]} games only.`;
  }
  return 'Measured in tournament and online games.';
}

function gamesLabel(count: number): string {
  return count === 1 ? 'game' : 'games';
}

function FocusTrendCard({ measurement }: { measurement: FocusMeasurement }) {
  const games = measurement.windowGames;
  if (measurement.trend === 'insufficient_evidence') {
    return (
      <Card>
        <Heading level={2}>{STREAM_LABEL[measurement.stream]}</Heading>
        <p className="mt-2 text-muted">
          We cannot say yet whether this is working. It rests on {games} analysed{' '}
          {gamesLabel(games)} in this stream; more games will make a verdict possible.
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <Heading level={2}>{STREAM_LABEL[measurement.stream]}</Heading>
      <p className="mt-2">
        {TREND_LABEL[measurement.trend]}{' '}
        <span aria-hidden="true" className="font-mono">
          {TREND_ARROW[measurement.trend]}
        </span>
      </p>
      <p className="mt-1 font-mono">
        {formatValue(measurement.baselineValue)} → {formatValue(measurement.currentValue)}{' '}
        {measurement.unit}
      </p>
      <p className="mt-1 text-sm text-muted">
        Measured over {games} {gamesLabel(games)}.
      </p>
    </Card>
  );
}

function CoachInstructionCard({
  focus,
  catalogue,
}: {
  focus: ActiveFocus;
  catalogue: FocusCatalogueEntry[];
}) {
  const paired =
    focus.pairedFocusId === null
      ? undefined
      : catalogue.find((entry) => entry.id === focus.pairedFocusId);
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Badge label="Unverified" variant="neutral" />
        </div>
        <p className="mt-2 whitespace-pre-wrap">{focus.coachInstruction ?? ''}</p>
        <p className="mt-2 text-muted">
          {paired !== undefined
            ? `Paired with ${paired.title}. The numbers below measure that focus, not the instruction.`
            : 'Paired with a measurable focus. The numbers below measure that focus, not the instruction.'}
        </p>
      </Card>
      {focus.measurements.length === 0 ? (
        <p className="text-muted">
          No verification yet. The first verdict appears once enough analysed games have
          accumulated.
        </p>
      ) : (
        focus.measurements.map((measurement) => (
          <FocusTrendCard key={measurement.stream} measurement={measurement} />
        ))
      )}
    </div>
  );
}

function CatalogueFocusCard({ focus }: { focus: ActiveFocus }) {
  return (
    <div className="space-y-4">
      {focus.catalogue !== null ? (
        <p className="text-muted">{focus.catalogue.description}</p>
      ) : null}
      {focus.measurements.length === 0 ? (
        <p className="text-muted">
          No verification yet. The first verdict appears once enough analysed games have
          accumulated.
        </p>
      ) : (
        focus.measurements.map((measurement) => (
          <FocusTrendCard key={measurement.stream} measurement={measurement} />
        ))
      )}
    </div>
  );
}

const createdFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function ShareSection({ playerId }: { playerId: string }) {
  const queryClient = useQueryClient();
  const sheetsQuery = useQuery(proofSheetsQueryOptions(playerId));
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [copied, setCopied] = useState(false);

  const current = sheetsQuery.data?.[0];

  async function handleCreate() {
    setCreating(true);
    setError(null);
    setCopied(false);
    try {
      await proofSheetApi.createProofSheet(playerId);
      setRevoked(false);
      await queryClient.invalidateQueries({ queryKey: ['proof-sheets', playerId] });
    } catch {
      setError('The share link could not be created. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  async function handleRevoke(sheet: ProofSheet) {
    const confirmed = window.confirm(
      'Revoke this link? Anyone holding it will no longer be able to open the page.',
    );
    if (!confirmed) return;
    setRevoking(true);
    setError(null);
    try {
      await proofSheetApi.revokeProofSheet(sheet.id);
      setRevoked(true);
      await queryClient.invalidateQueries({ queryKey: ['proof-sheets', playerId] });
    } catch {
      setError('The link could not be revoked. Please try again.');
    } finally {
      setRevoking(false);
    }
  }

  return (
    <Card>
      <Heading level={2}>Share a proof sheet</Heading>
      {error !== null ? (
        <div className="mt-4">
          <StatusMessage tone="error">{error}</StatusMessage>
        </div>
      ) : null}
      {revoked ? (
        <div className="mt-4">
          <StatusMessage tone="info">This link is revoked. You can create a new one.</StatusMessage>
        </div>
      ) : null}
      {sheetsQuery.isPending ? (
        <div
          role="status"
          aria-label="Loading share link"
          className="mt-4 h-4 w-64 rounded-control bg-sunken"
        />
      ) : sheetsQuery.isError ? (
        <p className="mt-4 text-muted">Your share link could not be loaded.</p>
      ) : revoked || current === undefined ? (
        <div className="mt-4">
          <p className="text-muted">Send a parent a before-and-after page for this focus.</p>
          <Button
            label={creating ? 'Creating...' : 'Create a share link'}
            variant="primary"
            onClick={() => void handleCreate()}
            className="mt-3 press"
            isDisabled={creating}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="text-muted">
            Created on {createdFormatter.format(new Date(current.createdAt))}.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-sm text-primary">
              {current.url}
            </span>
            <Button
              label={copied ? 'Copied' : 'Copy'}
              variant="secondary"
              onClick={() => void handleCopy(current.url)}
              className="press"
            />
          </div>
          <Button
            label={revoking ? 'Revoking...' : 'Revoke link'}
            variant="secondary"
            onClick={() => void handleRevoke(current)}
            className="press"
            isDisabled={revoking}
          />
        </div>
      )}
    </Card>
  );
}

export function ActiveFocusView({
  focus,
  catalogue,
  playerId,
  onChange,
}: {
  focus: ActiveFocus;
  catalogue: FocusCatalogueEntry[];
  playerId: string;
  onChange: () => void;
}) {
  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <Link to="/account" className={secondaryLinkClassName}>
          Back to your account
        </Link>
        <Heading level={1}>
          {focus.unverified ? "Your coach's focus" : (focus.catalogue?.title ?? 'Your focus')}
        </Heading>
      </header>
      {focus.unverified ? (
        <CoachInstructionCard focus={focus} catalogue={catalogue} />
      ) : (
        <CatalogueFocusCard focus={focus} />
      )}
      <ShareSection playerId={playerId} />
      <Button label="Change focus" variant="secondary" onClick={onChange} className="press" />
    </div>
  );
}

function RankingSection({
  playerId,
  stream,
  onStreamChange,
}: {
  playerId: string;
  stream: Stream;
  onStreamChange: (stream: Stream) => void;
}) {
  const reportQuery = useQuery(reportQueryOptions(playerId, stream));
  return (
    <section aria-labelledby="ranking-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading level={2} id="ranking-heading">
          Your ranked weaknesses
        </Heading>
        <StreamToggle stream={stream} onChange={onStreamChange} ariaLabel="Ranking stream" />
      </div>
      {reportQuery.isPending ? (
        <div role="status" aria-busy="true" className="space-y-2">
          <div className="h-4 w-48 rounded-control bg-sunken" />
          <div className="h-4 w-64 rounded-control bg-sunken" />
        </div>
      ) : reportQuery.isError ? (
        <p className="text-muted">
          {reportQuery.error instanceof ApiRequestError && reportQuery.error.status === 404
            ? 'No analysed games in this stream yet. Import games to get a ranking.'
            : 'Your ranking could not be loaded right now.'}
        </p>
      ) : reportQuery.data.weaknesses.length === 0 ? (
        <p className="text-muted">
          Not enough evidence to rank your weaknesses in this stream yet.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">Ranked by rating leak.</p>
          <ol className="space-y-2">
            {reportQuery.data.weaknesses.map((weakness) => (
              <li key={weakness.id} className="flex items-baseline gap-3">
                <span className="w-8 shrink-0 font-mono text-sm text-muted">#{weakness.rank}</span>
                <span className="flex-1">{weakness.label}</span>
                <span className="font-mono">
                  {weakness.saturated ? `at least ${weakness.ratingLeak}` : weakness.ratingLeak}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
      <Link
        to="/account/players/$playerId/report"
        params={{ playerId }}
        search={{ stream }}
        className="inline-flex min-h-11 items-center font-ui text-sm text-accent underline transition-control"
      >
        View full report
      </Link>
    </section>
  );
}

function CatalogueList({
  catalogue,
  submitting,
  onChoose,
}: {
  catalogue: FocusCatalogueEntry[];
  submitting: boolean;
  onChoose: (key: string) => void;
}) {
  return (
    <section aria-labelledby="catalogue-heading" className="space-y-3">
      <Heading level={2} id="catalogue-heading">
        Choose a focus
      </Heading>
      <ul className="grid grid-cols-1 gap-4">
        {catalogue.map((entry) => (
          <li key={entry.id}>
            <Card>
              <Heading level={3}>{entry.title}</Heading>
              <p className="mt-2">{entry.description}</p>
              <p className="mt-1 text-muted">{entry.measureDescription}</p>
              <p className="mt-1 text-muted">{measurableStreamsStatement(entry)}</p>
              <Button
                label={`Set ${entry.title}`}
                variant="primary"
                onClick={() => onChoose(entry.key)}
                isDisabled={submitting}
                className="mt-3 min-h-11 press"
              />
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CoachInstructionForm({
  catalogue,
  submitting,
  onSubmit,
}: {
  catalogue: FocusCatalogueEntry[];
  submitting: boolean;
  onSubmit: (body: SetFocus) => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [pairedKey, setPairedKey] = useState('');
  const [instructionError, setInstructionError] = useState<string | undefined>(undefined);
  const [pairedError, setPairedError] = useState<string | undefined>(undefined);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = instruction.trim();
    const nextInstructionError =
      trimmed.length === 0 ? 'Write the instruction in the coach\u2019s own words.' : undefined;
    const nextPairedError =
      pairedKey === ''
        ? 'Choose a measurable focus to pair with, so we can still show whether the work is helping.'
        : undefined;
    setInstructionError(nextInstructionError);
    setPairedError(nextPairedError);
    if (nextInstructionError !== undefined || nextPairedError !== undefined) return;
    onSubmit({ source: 'coach', coachInstruction: trimmed, pairedCatalogueKey: pairedKey });
  }

  return (
    <section aria-labelledby="coach-heading" className="space-y-3">
      <Heading level={2} id="coach-heading">
        A focus from your coach
      </Heading>
      <Card>
        <p className="text-muted">
          An instruction in the coach's own words cannot be measured directly, so we pair it with a
          measurable focus and show that focus's number, not a measurement of the instruction.
        </p>
        <form
          className="mt-4"
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
        >
          <FormLayout>
            <Field
              label="Coach instruction"
              inputID="coachInstruction"
              status={
                instructionError === undefined
                  ? undefined
                  : { type: 'error', message: instructionError }
              }
            >
              <textarea
                id="coachInstruction"
                name="coachInstruction"
                rows={4}
                maxLength={500}
                value={instruction}
                onChange={(event) => {
                  setInstruction(event.target.value);
                  setInstructionError(undefined);
                }}
                aria-invalid={instructionError === undefined ? undefined : true}
                aria-describedby={
                  instructionError === undefined ? undefined : 'coachInstruction-status'
                }
                className={textareaClassName}
              />
            </Field>
            <Field
              label="Paired measurable focus"
              inputID="pairedFocus"
              status={
                pairedError === undefined ? undefined : { type: 'error', message: pairedError }
              }
            >
              <select
                id="pairedFocus"
                name="pairedFocus"
                value={pairedKey}
                onChange={(event) => {
                  setPairedKey(event.target.value);
                  setPairedError(undefined);
                }}
                aria-invalid={pairedError === undefined ? undefined : true}
                aria-describedby={pairedError === undefined ? undefined : 'pairedFocus-status'}
                className={selectClassName}
              >
                <option value="">Choose a focus to pair with</option>
                {catalogue.map((entry) => (
                  <option key={entry.id} value={entry.key}>
                    {entry.title}
                  </option>
                ))}
              </select>
            </Field>
            <Button
              type="submit"
              label="Set coach focus"
              variant="primary"
              isDisabled={submitting}
              isLoading={submitting}
              className="min-h-11 press"
            />
          </FormLayout>
        </form>
      </Card>
    </section>
  );
}

export function FocusChoiceView({
  playerId,
  stream,
  onStreamChange,
  catalogue,
  catalogueFailed,
  replacing,
  submitting,
  formError,
  onSet,
}: {
  playerId: string;
  stream: Stream;
  onStreamChange: (stream: Stream) => void;
  catalogue: FocusCatalogueEntry[];
  catalogueFailed: boolean;
  replacing: ActiveFocus | null;
  submitting: boolean;
  formError: string | null;
  onSet: (body: SetFocus) => Promise<void>;
}) {
  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <Link to="/account" className={secondaryLinkClassName}>
          Back to your account
        </Link>
        <Heading level={1}>Set your focus</Heading>
        {replacing !== null ? (
          <p className="text-muted">
            {replacing.catalogue !== null
              ? `Setting a new focus ends your current one: ${replacing.catalogue.title}.`
              : 'Setting a new focus ends your current coach focus.'}
          </p>
        ) : null}
      </header>

      {formError !== null ? <StatusMessage tone="error">{formError}</StatusMessage> : null}
      {submitting ? <StatusMessage tone="info">Setting your focus...</StatusMessage> : null}

      <RankingSection playerId={playerId} stream={stream} onStreamChange={onStreamChange} />

      {catalogueFailed ? (
        <p className="text-muted">The focus catalogue could not be loaded right now. Try again.</p>
      ) : (
        <>
          <CatalogueList
            catalogue={catalogue}
            submitting={submitting}
            onChoose={(key) => {
              void onSet({ source: 'self', catalogueKey: key });
            }}
          />
          <CoachInstructionForm
            catalogue={catalogue}
            submitting={submitting}
            onSubmit={(body) => {
              void onSet(body);
            }}
          />
        </>
      )}
    </div>
  );
}

function FocusSkeleton() {
  return (
    <div role="status" aria-label="Loading focus" aria-busy="true" className="space-y-4">
      <div className="h-8 w-48 rounded-control bg-sunken" />
      <div className="h-4 w-72 rounded-control bg-sunken" />
      <div className="h-32 rounded-surface bg-sunken" />
    </div>
  );
}

function FocusError() {
  return (
    <EmptyState
      title="Your focus could not be loaded"
      description="Try again, or go back to your account."
      headingLevel={2}
    />
  );
}

export function FocusRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { playerId } = useParams({ from: '/account/players/$playerId/focus' });
  const { stream } = useSearch({ from: '/account/players/$playerId/focus' });
  const [choosing, setChoosing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const focusesQuery = useQuery(focusesQueryOptions());
  const focusQuery = useQuery(focusQueryOptions(playerId));

  const onStreamChange = (next: Stream) => {
    void navigate({
      to: '/account/players/$playerId/focus',
      params: { playerId },
      search: { stream: next },
    });
  };

  async function handleSet(body: SetFocus) {
    setSubmitting(true);
    setFormError(null);
    try {
      await focusApi.setFocus(playerId, body);
      await queryClient.invalidateQueries({ queryKey: ['focus', playerId] });
      setChoosing(false);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.status === 401) {
          queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
          await navigate({ to: '/sign-in' });
          return;
        }
        if (error.status === 403) {
          setFormError('This focus cannot be set for this player.');
          return;
        }
        if (error.status === 404) {
          setFormError('That focus is no longer available. Choose another.');
          return;
        }
      }
      setFormError('The focus could not be set. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (focusesQuery.isPending || focusQuery.isPending) {
    return (
      <div className="space-y-6">
        <header className="space-y-4">
          <Link to="/account" className={secondaryLinkClassName}>
            Back to your account
          </Link>
          <Heading level={1}>Your focus</Heading>
        </header>
        <FocusSkeleton />
      </div>
    );
  }

  if (
    focusQuery.isError &&
    !(focusQuery.error instanceof ApiRequestError && focusQuery.error.status === 404)
  ) {
    return (
      <div className="space-y-6">
        <header className="space-y-4">
          <Link to="/account" className={secondaryLinkClassName}>
            Back to your account
          </Link>
          <Heading level={1}>Your focus</Heading>
        </header>
        <FocusError />
      </div>
    );
  }

  const activeFocus = focusQuery.data;
  const catalogue = focusesQuery.data ?? [];

  if (choosing || activeFocus === undefined) {
    return (
      <FocusChoiceView
        playerId={playerId}
        stream={stream}
        onStreamChange={onStreamChange}
        catalogue={catalogue}
        catalogueFailed={focusesQuery.isError}
        replacing={activeFocus ?? null}
        submitting={submitting}
        formError={formError}
        onSet={handleSet}
      />
    );
  }

  return (
    <ActiveFocusView
      focus={activeFocus}
      catalogue={catalogue}
      playerId={playerId}
      onChange={() => setChoosing(true)}
    />
  );
}

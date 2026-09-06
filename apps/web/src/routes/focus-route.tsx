import { useState, type FormEvent } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
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

import { UpgradePrompt } from '../components/upgrade-prompt.tsx';
import { AssignmentLinksSection } from '../components/assignment-links-section.tsx';
import { track } from '../analytics.ts';
import { StatusMessage } from '../components/status-message.tsx';
import { StreamToggle } from '../components/stream-toggle.tsx';
import {
  focusQueryOptions,
  focusesQueryOptions,
  ME_QUERY_KEY,
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
    const toGo = measurement.gamesToGo;
    return (
      <Card>
        <Heading level={2}>{STREAM_LABEL[measurement.stream]}</Heading>
        {toGo !== null ? (
          <>
            <Text as="p" display="block" className="mt-2">
              {toGo} more {gamesLabel(toGo)} to go.
            </Text>
            <Text as="p" display="block" type="supporting" className="mt-1">
              A verdict compares ten analysed games before your focus started with ten since; games
              you import count toward the second ten.
            </Text>
          </>
        ) : (
          <Text as="p" display="block" type="supporting" className="mt-2">
            We cannot say yet whether this is working. It rests on {games} analysed{' '}
            {gamesLabel(games)} in this stream; more games may make a verdict possible.
          </Text>
        )}
        {measurement.stream === 'online' && (
          <Text as="p" display="block" type="supporting" className="mt-2 text-sm">
            Online blitz games count; rapid and classical are excluded from the fast signal.
          </Text>
        )}
      </Card>
    );
  }
  return (
    <Card>
      <Heading level={2}>{STREAM_LABEL[measurement.stream]}</Heading>
      <Text as="p" display="block" className="mt-2">
        {TREND_LABEL[measurement.trend]}{' '}
        <span aria-hidden="true" className="font-mono">
          {TREND_ARROW[measurement.trend]}
        </span>
      </Text>
      <Text as="p" display="block" className="mt-1 font-mono">
        {formatValue(measurement.baselineValue)} → {formatValue(measurement.currentValue)}{' '}
        {measurement.unit}
      </Text>
      <Text as="p" display="block" type="supporting" className="mt-1 text-sm">
        Measured over {games} {gamesLabel(games)}.
      </Text>
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
        <Text as="p" display="block" className="mt-2 whitespace-pre-wrap">
          {focus.coachInstruction ?? ''}
        </Text>
        <Text as="p" display="block" type="supporting" className="mt-2">
          {paired !== undefined
            ? `Paired with ${paired.title}. The numbers below measure that focus, not the instruction.`
            : 'Paired with a measurable focus. The numbers below measure that focus, not the instruction.'}
        </Text>
      </Card>
      {focus.measurements.length === 0 ? (
        <Text as="p" display="block" type="supporting">
          No verification yet. The first verdict appears once enough analysed games have
          accumulated.
        </Text>
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
        <Text as="p" display="block" type="supporting">
          {focus.catalogue.description}
        </Text>
      ) : null}
      {focus.measurements.length === 0 ? (
        <Text as="p" display="block" type="supporting">
          No verification yet. The first verdict appears once enough analysed games have
          accumulated.
        </Text>
      ) : (
        focus.measurements.map((measurement) => (
          <FocusTrendCard key={measurement.stream} measurement={measurement} />
        ))
      )}
    </div>
  );
}

/**
 * ST-129. The practice line: effort beside the verdicts, never a third
 * speed. It renders whenever the focus is measurable, including the honest
 * zero; a null practice (no measurable focus) renders nothing.
 */
function PracticeLine({ practice }: { practice: ActiveFocus['practice'] }) {
  if (practice === null) return null;
  return (
    <Card>
      {practice.total === 0 ? (
        <>
          <Text as="p" display="block" className="mt-2">
            No practice yet.
          </Text>
          <Text as="p" display="block" type="supporting" className="mt-1">
            Drills you run from your report&rsquo;s weakness cards will show here.
          </Text>
        </>
      ) : (
        <Text as="p" display="block" className="mt-2">
          {`Practice: ${practice.solved} of ${practice.total} drills solved across ${
            practice.groups
          } ${practice.groups === 1 ? 'group' : 'groups'}.`}
        </Text>
      )}
      <Text as="p" display="block" type="supporting" className="mt-1 text-sm">
        Practice measures effort. The online signal and the tournament proof measure play.
      </Text>
    </Card>
  );
}

export function ActiveFocusView({
  focus,
  catalogue,
  onChange,
}: {
  focus: ActiveFocus;
  catalogue: FocusCatalogueEntry[];
  onChange: () => void;
}) {
  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <Heading level={1}>
          {focus.unverified ? "Your coach's focus" : (focus.catalogue?.title ?? 'Your focus')}
        </Heading>
      </header>
      {focus.unverified ? (
        <CoachInstructionCard focus={focus} catalogue={catalogue} />
      ) : (
        <CatalogueFocusCard focus={focus} />
      )}
      <PracticeLine practice={focus.practice} />
      <Button
        label="Change focus"
        variant="secondary"
        onClick={onChange}
        className="min-h-11 press"
      />
    </div>
  );
}

function RankingSection({
  stream,
  onStreamChange,
}: {
  stream: Stream;
  onStreamChange: (stream: Stream) => void;
}) {
  const reportQuery = useQuery(reportQueryOptions(stream));
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
        <Text as="p" display="block" type="supporting">
          {reportQuery.error instanceof ApiRequestError && reportQuery.error.status === 404
            ? 'No analysed games in this stream yet. Import games to get a ranking.'
            : reportQuery.error instanceof ApiRequestError && reportQuery.error.status === 422
              ? 'Analysed games so far are too few rated ones for a ranking. Import more rated games.'
              : 'Your ranking could not be loaded right now.'}
        </Text>
      ) : reportQuery.data.weaknesses.length === 0 ? (
        <Text as="p" display="block" type="supporting">
          Not enough evidence to rank your weaknesses in this stream yet.
        </Text>
      ) : (
        <>
          <Text as="p" display="block" type="supporting" className="text-sm">
            Ranked by rating leak.
          </Text>
          <ol className="space-y-2">
            {reportQuery.data.weaknesses.map((weakness) => (
              <li key={weakness.id} className="flex items-baseline gap-3">
                <Text type="supporting" className="w-8 shrink-0 font-mono text-sm">
                  #{weakness.rank}
                </Text>
                <span className="flex-1">{weakness.label}</span>
                <span className="font-mono">
                  {weakness.saturated ? `at least ${weakness.ratingLeak}` : weakness.ratingLeak}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
      <Link href={`/report?stream=${stream}`}>View full report</Link>
    </section>
  );
}

export function CatalogueList({
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
      <ul className="grid grid-cols-1 gap-4 stagger-in">
        {catalogue.map((entry) => (
          <li key={entry.id}>
            <Card>
              <Heading level={3}>{entry.title}</Heading>
              <Text as="p" display="block" className="mt-2">
                {entry.description}
              </Text>
              <Text as="p" display="block" type="supporting" className="mt-1">
                {entry.measureDescription}
              </Text>
              <Text as="p" display="block" type="supporting" className="mt-1">
                {measurableStreamsStatement(entry)}
              </Text>
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

export function CoachInstructionForm({
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
        <Text as="p" display="block" type="supporting">
          An instruction in the coach's own words cannot be measured directly, so we pair it with a
          measurable focus and show that focus's number, not a measurement of the instruction.
        </Text>
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
  stream,
  onStreamChange,
  catalogue,
  catalogueFailed,
  replacing,
  submitting,
  formError,
  onSet,
}: {
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
        <Heading level={1}>Set your focus</Heading>
        {replacing !== null ? (
          <Text as="p" display="block" type="supporting">
            {replacing.catalogue !== null
              ? `Setting a new focus ends your current one: ${replacing.catalogue.title}.`
              : 'Setting a new focus ends your current coach focus.'}
          </Text>
        ) : null}
      </header>

      {formError !== null ? <StatusMessage tone="error">{formError}</StatusMessage> : null}
      {submitting ? <StatusMessage tone="info">Setting your focus...</StatusMessage> : null}

      <RankingSection stream={stream} onStreamChange={onStreamChange} />

      {catalogueFailed ? (
        <StatusMessage tone="error">
          The focus catalogue could not be loaded right now. Try again.
        </StatusMessage>
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

/**
 * ST-115. The submit flow the focus page and the debrief's focus section
 * share: one place for the analytics call, the cache invalidation, and the
 * error mapping. Resolves true only when the focus was set, so the caller
 * can leave the choice view without re-reading the query.
 */
export function useSetFocus() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function setFocus(body: SetFocus): Promise<boolean> {
    setSubmitting(true);
    setFormError(null);
    try {
      await focusApi.setFocus(body);
      track('focus_set', {
        source: body.source,
        ...(body.source === 'coach' ? {} : { catalogueKey: body.catalogueKey }),
      });
      await queryClient.invalidateQueries({ queryKey: ['focus'] });
      return true;
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.status === 401) {
          queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
          await navigate({ to: '/sign-in' });
          return false;
        }
        if (error.status === 403) {
          setFormError('This focus cannot be set for this player.');
          return false;
        }
        if (error.status === 404) {
          setFormError('That focus is no longer available. Choose another.');
          return false;
        }
      }
      setFormError('The focus could not be set. Please try again.');
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  return { setFocus, submitting, formError };
}

export function FocusRoute() {
  const navigate = useNavigate();
  const { stream } = useSearch({ from: '/account/focus' });
  const [choosing, setChoosing] = useState(false);
  const { setFocus, submitting, formError } = useSetFocus();

  const focusesQuery = useQuery(focusesQueryOptions());
  const focusQuery = useQuery(focusQueryOptions());

  const onStreamChange = (next: Stream) => {
    void navigate({
      to: '/focus',
      search: { stream: next },
    });
  };

  async function handleSet(body: SetFocus) {
    const set = await setFocus(body);
    if (set) setChoosing(false);
  }

  if (focusesQuery.isPending || focusQuery.isPending) {
    return (
      <div className="space-y-6">
        <header className="space-y-4">
          <Heading level={1}>Your focus</Heading>
        </header>
        <FocusSkeleton />
      </div>
    );
  }

  if (
    focusQuery.isError &&
    focusQuery.error instanceof ApiRequestError &&
    focusQuery.error.code === 'upgrade_required'
  ) {
    return (
      <div className="space-y-6">
        <header className="space-y-4">
          <Heading level={1}>Your focus</Heading>
        </header>
        <UpgradePrompt title="Your focus is part of the paid loop" />
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
      <>
        <FocusChoiceView
          stream={stream}
          onStreamChange={onStreamChange}
          catalogue={catalogue}
          catalogueFailed={focusesQuery.isError}
          replacing={activeFocus ?? null}
          submitting={submitting}
          formError={formError}
          onSet={handleSet}
        />
        <AssignmentLinksSection catalogue={catalogue} activeCatalogueKey={null} />
      </>
    );
  }

  // The link form pre-fills with the measurable focus the active one rides:
  // the catalogue entry itself, or the paired focus for an F13 instruction.
  const pairedEntry =
    activeFocus.pairedFocusId !== null
      ? catalogue.find((entry) => entry.id === activeFocus.pairedFocusId)
      : undefined;
  const activeCatalogueKey = activeFocus.catalogue?.key ?? pairedEntry?.key ?? null;

  return (
    <>
      <ActiveFocusView
        focus={activeFocus}
        catalogue={catalogue}
        onChange={() => setChoosing(true)}
      />
      <AssignmentLinksSection catalogue={catalogue} activeCatalogueKey={activeCatalogueKey} />
    </>
  );
}

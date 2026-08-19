import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router';
import { describe, expect, test, vi } from 'vitest';
import type { Report } from '../api/diagnosis-api.ts';
import type { ActiveFocus, FocusCatalogueEntry } from '../api/focus-api.ts';
import { createAppRouter } from '../router.tsx';
import { ActiveFocusView, FocusChoiceView } from './focus-route.tsx';

const playerId = '00000000-0000-4000-8000-000000000001';

const convertingWon: FocusCatalogueEntry = {
  id: '11111111-1111-4111-8111-111111111111',
  key: 'converting_won_positions',
  title: 'Converting won positions',
  description: 'Winning the games the position already says are won.',
  measureDescription: 'The share of won positions converted to wins.',
  measurableStreams: ['tournament', 'online'],
  version: 1,
};

const timeManagement: FocusCatalogueEntry = {
  id: '22222222-2222-4222-8222-222222222222',
  key: 'time_management',
  title: 'Time management',
  description: 'Using the clock so the position decides the game, not the flag.',
  measureDescription: 'The move where time trouble begins.',
  measurableStreams: ['online'],
  version: 1,
};

const tacticalAlertness: FocusCatalogueEntry = {
  id: '33333333-3333-4333-8333-333333333333',
  key: 'tactical_alertness',
  title: 'Tactical alertness',
  description: 'Spotting the tactical motifs a position offers.',
  measureDescription: 'The tactical motifs missed.',
  measurableStreams: ['tournament', 'online'],
  version: 1,
};

function activeFocusFixture(overrides: Partial<ActiveFocus> = {}): ActiveFocus {
  return {
    id: 'focus-1',
    source: 'self',
    catalogue: convertingWon,
    coachInstruction: null,
    unverified: false,
    pairedFocusId: null,
    startedAt: '2026-08-01T00:00:00.000Z',
    measurements: [
      {
        stream: 'tournament',
        measuredAt: '2026-08-16T00:00:00.000Z',
        windowGames: 10,
        baselineValue: 0.6,
        currentValue: 0.72,
        unit: 'share converted',
        trend: 'improving',
      },
      {
        stream: 'online',
        measuredAt: '2026-08-16T00:00:00.000Z',
        windowGames: 5,
        baselineValue: null,
        currentValue: null,
        unit: 'share converted',
        trend: 'insufficient_evidence',
      },
    ],
    ...overrides,
  };
}

const emptyReport: Report = {
  id: 'report-1',
  playerId,
  stream: 'tournament',
  generatedAt: '2026-08-15T12:00:00.000Z',
  gamesCovered: 0,
  windowStart: '2025-09-01T00:00:00.000Z',
  windowEnd: '2026-05-31T00:00:00.000Z',
  timeTroubleFromMove: null,
  weaknesses: [],
  narrative: null,
};

function renderFocusChoice(props: Partial<Parameters<typeof FocusChoiceView>[0]> = {}) {
  const user = userEvent.setup();
  const queryClient = new QueryClient();
  const history = createMemoryHistory();
  const router = createAppRouter({ history, queryClient });
  queryClient.setQueryData(['report', playerId, 'tournament'], emptyReport);
  render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <FocusChoiceView
          playerId={playerId}
          stream="tournament"
          onStreamChange={vi.fn()}
          catalogue={[convertingWon, timeManagement, tacticalAlertness]}
          catalogueFailed={false}
          replacing={null}
          submitting={false}
          formError={null}
          onSet={vi.fn().mockResolvedValue(undefined)}
          {...props}
        />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
  return { user, queryClient };
}

function renderActiveFocus(
  focus: ActiveFocus,
  catalogue: FocusCatalogueEntry[] = [tacticalAlertness],
) {
  const user = userEvent.setup();
  const queryClient = new QueryClient();
  const history = createMemoryHistory();
  const router = createAppRouter({ history, queryClient });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <ActiveFocusView focus={focus} catalogue={catalogue} onChange={vi.fn()} />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
  return { user };
}

describe('FocusChoiceView', () => {
  test('offers each focus with title, description, measure, and streams', () => {
    renderFocusChoice();
    expect(screen.getByRole('heading', { name: 'Converting won positions' })).toBeInTheDocument();
    expect(
      screen.getByText('Winning the games the position already says are won.'),
    ).toBeInTheDocument();
    expect(screen.getByText('The share of won positions converted to wins.')).toBeInTheDocument();
    expect(screen.getAllByText('Measured in tournament and online games.')).toHaveLength(2);
  });

  test('states time management is online only and why', () => {
    renderFocusChoice();
    expect(
      screen.getByText(
        'Measured in online games only: tournament scoresheets do not carry clock data.',
      ),
    ).toBeInTheDocument();
  });

  test('sets a catalogue focus as self', async () => {
    const onSet = vi.fn().mockResolvedValue(undefined);
    const { user } = renderFocusChoice({ onSet });
    await user.click(screen.getByRole('button', { name: 'Set Converting won positions' }));
    expect(onSet).toHaveBeenCalledWith({
      source: 'self',
      catalogueKey: 'converting_won_positions',
    });
  });

  test('presents setting a focus as replacing the current one', () => {
    renderFocusChoice({ replacing: activeFocusFixture() });
    expect(
      screen.getByText('Setting a new focus ends your current one: Converting won positions.'),
    ).toBeInTheDocument();
  });

  test('coach form says why a paired focus is required rather than a bare error', async () => {
    const onSet = vi.fn().mockResolvedValue(undefined);
    const { user } = renderFocusChoice({ onSet });
    await user.type(screen.getByLabelText('Coach instruction'), 'Work on the clock.');
    await user.click(screen.getByRole('button', { name: 'Set coach focus' }));
    expect(
      screen.getByText(
        'Choose a measurable focus to pair with, so we can still show whether the work is helping.',
      ),
    ).toBeInTheDocument();
    expect(onSet).not.toHaveBeenCalled();
  });

  test('coach form submits the instruction paired with a measurable focus', async () => {
    const onSet = vi.fn().mockResolvedValue(undefined);
    const { user } = renderFocusChoice({ onSet });
    await user.type(screen.getByLabelText('Coach instruction'), 'Work on the clock.');
    await user.selectOptions(
      screen.getByLabelText('Paired measurable focus'),
      'tactical_alertness',
    );
    await user.click(screen.getByRole('button', { name: 'Set coach focus' }));
    expect(onSet).toHaveBeenCalledWith({
      source: 'coach',
      coachInstruction: 'Work on the clock.',
      pairedCatalogueKey: 'tactical_alertness',
    });
  });

  test('shows an explicit error when the catalogue cannot be loaded', () => {
    renderFocusChoice({ catalogueFailed: true });
    expect(
      screen.getByText('The focus catalogue could not be loaded right now. Try again.'),
    ).toBeInTheDocument();
  });
});

describe('ActiveFocusView', () => {
  test('renders per-stream trends with the stream named and windowGames', () => {
    renderActiveFocus(activeFocusFixture());
    expect(screen.getByRole('heading', { name: 'Tournament' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Online' })).toBeInTheDocument();
    expect(screen.getByText(/Improving/)).toBeInTheDocument();
    expect(screen.getByText(/0\.6 → 0\.72 share converted/)).toBeInTheDocument();
    expect(screen.getByText(/Measured over 10 games\./)).toBeInTheDocument();
  });

  test('renders insufficient evidence as prose, not a zero or a chart', () => {
    renderActiveFocus(activeFocusFixture());
    expect(screen.getByText(/We cannot say yet whether this is working/)).toBeInTheDocument();
    expect(screen.getByText(/more games will make a verdict possible/)).toBeInTheDocument();
  });

  test('shows a coach instruction verbatim, marked unverified, with the paired number', () => {
    const focus = activeFocusFixture({
      source: 'coach',
      catalogue: null,
      coachInstruction: 'Work on seeing the tactics you miss.',
      unverified: true,
      pairedFocusId: tacticalAlertness.id,
      measurements: [
        {
          stream: 'online',
          measuredAt: '2026-08-16T00:00:00.000Z',
          windowGames: 12,
          baselineValue: 0.4,
          currentValue: 0.55,
          unit: 'share found',
          trend: 'improving',
        },
      ],
    });
    renderActiveFocus(focus, [tacticalAlertness]);
    expect(screen.getByText('Unverified')).toBeInTheDocument();
    expect(screen.getByText('Work on seeing the tactics you miss.')).toBeInTheDocument();
    expect(screen.getByText(/Paired with Tactical alertness/)).toBeInTheDocument();
    expect(screen.getByText(/not the instruction/)).toBeInTheDocument();
  });

  test('renders the coach instruction as text, never as markup', () => {
    const instruction = 'Focus on <script>window.pwned = true</script> tactics';
    const focus = activeFocusFixture({
      source: 'coach',
      catalogue: null,
      coachInstruction: instruction,
      unverified: true,
      pairedFocusId: tacticalAlertness.id,
      measurements: [],
    });
    renderActiveFocus(focus, [tacticalAlertness]);
    expect(screen.getByText(instruction)).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
  });
});

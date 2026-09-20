import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider, RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import gsap from 'gsap';
import { track } from '../analytics.ts';
import { accountApi, ApiRequestError, type Me } from '../api/account-api.ts';
import { diagnosisApi, type Report, type Weakness } from '../api/diagnosis-api.ts';
import { focusApi, type ActiveFocus, type FocusCatalogueEntry } from '../api/focus-api.ts';
import { createAppRouter } from '../router.tsx';
import { ActiveFocusView, FocusChoiceView } from './focus-route.tsx';

vi.mock('../analytics.ts', () => ({
  safeProperties: (properties: Record<string, string | number>) => properties,
  track: vi.fn(),
}));

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
        gamesToGo: 0,
      },
      {
        stream: 'online',
        measuredAt: '2026-08-16T00:00:00.000Z',
        windowGames: 5,
        baselineValue: null,
        currentValue: null,
        unit: 'share converted',
        trend: 'insufficient_evidence',
        gamesToGo: 5,
      },
    ],
    practice: { solved: 12, total: 40, groups: 3 },
    ...overrides,
  };
}

const emptyReport: Report = {
  id: 'report-1',
  playerId,
  stream: 'tournament',
  tournamentId: null,
  generatedAt: '2026-08-15T12:00:00.000Z',
  gamesCovered: 0,
  windowStart: '2025-09-01T00:00:00.000Z',
  windowEnd: '2026-05-31T00:00:00.000Z',
  timeTroubleFromMove: null,
  timeTroubleReason: null,
  weaknesses: [],
  missedPunishment: null,
  phaseHeatmap: [],
  drillSuggestions: [],
  narrative: null,
};

function renderFocusChoice(props: Partial<Parameters<typeof FocusChoiceView>[0]> = {}) {
  const user = userEvent.setup();
  const queryClient = new QueryClient();
  queryClient.setQueryData(['report', 'tournament', null], emptyReport);
  const history = createMemoryHistory();
  const router = createAppRouter({ history, queryClient });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <FocusChoiceView
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
      screen.getAllByText(
        'Choose a measurable focus to pair with, so we can still show whether the work is helping.',
      ).length,
    ).toBeGreaterThan(0);
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
    // ST-139: the verdict renders twice - an sr-only value with the animated
    // figure aria-hidden on top - so the query is plural by design.
    expect(screen.getAllByText(/0\.6 → 0\.72 share converted/)).toHaveLength(2);
    expect(screen.getByText(/Measured over 10 games\./)).toBeInTheDocument();
  });

  test('ST-139: the animated verdict figure is aria-hidden over an sr-only value', () => {
    renderActiveFocus(activeFocusFixture());
    const [accessible, animated] = screen.getAllByText('0.6 → 0.72 share converted');
    expect(animated).toHaveAttribute('aria-hidden', 'true');
    expect(accessible).toHaveClass('sr-only');
  });

  test('ST-139: reduced motion leaves the verdict figure settled with no tween', () => {
    const original = window.matchMedia.bind(window);
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({ ...original(query), matches: query.includes('reduce') }),
    });
    try {
      renderActiveFocus(activeFocusFixture());
      const [, animated] = screen.getAllByText('0.6 → 0.72 share converted');
      if (animated === undefined) throw new Error('the animated verdict figure did not render');
      // No tween may start: the figure holds its natural, final state.
      expect(animated.style.opacity).toBe('');
      expect(animated.style.transform).toBe('');
      expect(animated.textContent).toBe('0.6 → 0.72 share converted');
    } finally {
      Object.defineProperty(window, 'matchMedia', { writable: true, value: original });
    }
  });

  test('ST-139: under motion the verdict figure enters from hidden and settles clean', async () => {
    const original = window.matchMedia.bind(window);
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({ ...original(query), matches: query.includes('no-preference') }),
    });
    gsap.globalTimeline.timeScale(20);
    try {
      renderActiveFocus(activeFocusFixture());
      const [, animated] = screen.getAllByText('0.6 → 0.72 share converted');
      if (animated === undefined) throw new Error('the animated verdict figure did not render');
      // The from-state applies synchronously on mount: the figure starts hidden.
      expect(animated.style.opacity).toBe('0');
      expect(animated.textContent).toBe('0.6 → 0.72 share converted');
      // The timeline ends with clearProps, so nothing inline remains.
      await waitFor(() => expect(animated.style.opacity).toBe(''));
      expect(animated).toBeVisible();
    } finally {
      gsap.globalTimeline.timeScale(1);
      Object.defineProperty(window, 'matchMedia', { writable: true, value: original });
    }
  });

  test('ST-116: a reachable floor counts the games between the player and a verdict', () => {
    renderActiveFocus(activeFocusFixture());
    expect(screen.getByText('5 more games to go.')).toBeInTheDocument();
    expect(
      screen.getByText(/ten analysed games before your focus started with ten since/),
    ).toBeInTheDocument();
    // The online card names the ST-040 scoping instead of promising a verdict
    // the scoping retired.
    expect(
      screen.getByText(/rapid and classical are excluded from the fast signal/),
    ).toBeInTheDocument();
  });

  test('ST-116: an unreachable floor refuses in prose, never a countdown', () => {
    const focus = activeFocusFixture({
      measurements: [
        {
          stream: 'tournament',
          measuredAt: '2026-08-16T00:00:00.000Z',
          windowGames: 10,
          baselineValue: null,
          currentValue: null,
          unit: 'share converted',
          trend: 'insufficient_evidence',
          gamesToGo: null,
        },
      ],
    });
    renderActiveFocus(focus);
    expect(screen.getByText(/We cannot say yet whether this is working/)).toBeInTheDocument();
    expect(screen.getByText(/more games may make a verdict possible/)).toBeInTheDocument();
    expect(screen.queryByText(/to go\./)).not.toBeInTheDocument();
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
          gamesToGo: 0,
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

  test('ST-129: practice shows beside the verdicts under the standing label', () => {
    renderActiveFocus(activeFocusFixture());
    expect(
      screen.getByText('Practice: 12 of 40 drills solved across 3 groups.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Practice measures effort. The online signal and the tournament proof measure play.',
      ),
    ).toBeInTheDocument();
  });

  test('ST-129: zero practice renders the honest empty state, never a zero verdict', () => {
    renderActiveFocus(activeFocusFixture({ practice: { solved: 0, total: 0, groups: 0 } }));
    expect(screen.getByText('No practice yet.')).toBeInTheDocument();
    expect(screen.getByText(/Drills you run from your report/)).toBeInTheDocument();
    expect(screen.queryByText(/drills solved/)).not.toBeInTheDocument();
  });

  test('ST-129: a null practice renders nothing', () => {
    renderActiveFocus(activeFocusFixture({ practice: null }));
    expect(screen.queryByText(/Practice measures effort/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No practice yet/)).not.toBeInTheDocument();
  });

  test('ST-129: a refused verdict keeps its own copy with practice beside it', () => {
    const focus = activeFocusFixture({
      measurements: [
        {
          stream: 'online',
          measuredAt: '2026-08-16T00:00:00.000Z',
          windowGames: 5,
          baselineValue: null,
          currentValue: null,
          unit: 'share converted',
          trend: 'insufficient_evidence',
          gamesToGo: null,
        },
      ],
    });
    renderActiveFocus(focus);
    expect(screen.getByText(/We cannot say yet whether this is working/)).toBeInTheDocument();
    expect(
      screen.getByText('Practice: 12 of 40 drills solved across 3 groups.'),
    ).toBeInTheDocument();
  });
});

const rankingWeakness: Weakness = {
  id: 'w-1',
  kind: 'motif',
  label: 'Missed captures',
  eco: null,
  ratingLeak: 34,
  saturated: false,
  halfPointsLost: 2.5,
  gamesAffected: 6,
  occurrences: 9,
  rank: 1,
  advice: null,
  actionItems: [],
  drilled: 0,
  groupKey: null,
  evidence: [],
  lineConsistency: null,
  retirementState: null,
};

function onlineReport(overrides: Partial<Report> = {}): Report {
  return { ...emptyReport, stream: 'online', ...overrides };
}

describe('FocusChoiceView ranking section', () => {
  test('admits honestly when the ranking has no evidence yet', () => {
    renderFocusChoice();
    expect(
      screen.getByText('Not enough evidence to rank your weaknesses in this stream yet.'),
    ).toBeInTheDocument();
  });

  test('holds a quiet loading row while the ranking loads', () => {
    vi.spyOn(diagnosisApi, 'getReport').mockReturnValue(Promise.withResolvers<Report>().promise);
    renderFocusChoice({ stream: 'online' });
    const busy = document.querySelector('div[role="status"][aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(screen.queryByText(/^Estimate · /)).not.toBeInTheDocument();
  });

  test('names the missing ranking as a missing-import problem, not a failure', async () => {
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'Not found.'),
    );
    renderFocusChoice({ stream: 'online' });
    expect(
      await screen.findByText(
        'No analysed games in this stream yet. Import games to get a ranking.',
      ),
    ).toBeInTheDocument();
  });

  test('names thin rated history as the reason a ranking refuses', async () => {
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(
      new ApiRequestError(422, 'not_enough_evidence', undefined, 'Too few rated games.'),
    );
    renderFocusChoice({ stream: 'online' });
    expect(
      await screen.findByText(
        'Analysed games so far are too few rated ones for a ranking. Import more rated games.',
      ),
    ).toBeInTheDocument();
  });

  test('keeps a failure to load the ranking from blaming the player', async () => {
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(new Error('502'));
    renderFocusChoice({ stream: 'online' });
    expect(
      await screen.findByText('Your ranking could not be loaded right now.'),
    ).toBeInTheDocument();
  });

  test('ranks the weaknesses with the leak, floored when saturated', async () => {
    vi.spyOn(diagnosisApi, 'getReport').mockResolvedValue(
      onlineReport({
        // ST-175. The note names the model's input, so the fixture states one.
        gamesCovered: 12,
        weaknesses: [
          rankingWeakness,
          { ...rankingWeakness, id: 'w-2', rank: 2, label: 'Hanging pieces', saturated: true },
        ],
      }),
    );
    renderFocusChoice({ stream: 'online' });
    expect(
      await screen.findByText(
        'Estimate · modelled from the 12 rated games in this window, not counted from results. Rows are ordered by it.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Estimate')).toHaveLength(2);
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('Missed captures')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.getByText('at least 34')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View full report' })).toHaveAttribute(
      'href',
      '/report?stream=online',
    );
  });

  test('routes the ranking stream change through the toggle', async () => {
    const onStreamChange = vi.fn();
    const { user } = renderFocusChoice({ onStreamChange });
    await user.click(screen.getByRole('radio', { name: 'Online' }));
    expect(onStreamChange).toHaveBeenCalledWith('online');
  });
});

describe('FocusChoiceView form and choice edges', () => {
  test('requires the instruction before the coach focus can be set', async () => {
    const onSet = vi.fn().mockResolvedValue(undefined);
    const { user } = renderFocusChoice({ onSet });
    await user.selectOptions(
      screen.getByLabelText('Paired measurable focus'),
      'tactical_alertness',
    );
    await user.click(screen.getByRole('button', { name: 'Set coach focus' }));
    expect(
      screen.getAllByText('Write the instruction in the coach\u2019s own words.').length,
    ).toBeGreaterThan(0);
    expect(onSet).not.toHaveBeenCalled();
  });

  test('clears each coach form error once the player fixes it', async () => {
    const onSet = vi.fn().mockResolvedValue(undefined);
    const { user } = renderFocusChoice({ onSet });
    await user.click(screen.getByRole('button', { name: 'Set coach focus' }));
    expect(
      screen.getAllByText('Write the instruction in the coach\u2019s own words.').length,
    ).toBeGreaterThan(0);
    await user.type(screen.getByLabelText('Coach instruction'), 'Work on the clock.');
    await user.selectOptions(
      screen.getByLabelText('Paired measurable focus'),
      'tactical_alertness',
    );
    // The live region keeps its announcement; the fields drop the invalid state.
    expect(screen.getByLabelText('Coach instruction')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Paired measurable focus')).not.toHaveAttribute('aria-invalid');
  });

  test('says the replacement ends a coach focus without a catalogue name', () => {
    renderFocusChoice({
      replacing: activeFocusFixture({ source: 'coach', catalogue: null, unverified: true }),
    });
    expect(
      screen.getByText('Setting a new focus ends your current coach focus.'),
    ).toBeInTheDocument();
  });

  test('offers nothing to choose from when the catalogue arrives empty', () => {
    renderFocusChoice({ catalogue: [] });
    expect(screen.getByRole('heading', { name: 'Choose a focus' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set Converting won positions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Set Tactical alertness' })).toBeNull();
  });

  test('explains an unlisted single-stream focus by its stream', () => {
    const endgameConversion: FocusCatalogueEntry = {
      id: '44444444-4444-4444-8444-444444444444',
      key: 'endgame_conversion',
      title: 'Endgame conversion',
      description: 'Turning winning endgames into points.',
      measureDescription: 'The share of winning endgames converted.',
      measurableStreams: ['tournament'],
      version: 1,
    };
    renderFocusChoice({ catalogue: [endgameConversion] });
    expect(screen.getByText('Measured in Tournament games only.')).toBeInTheDocument();
  });
});

describe('ActiveFocusView headings and trend words', () => {
  test('heads a coach focus without a catalogue as the coach\u2019s own', () => {
    renderActiveFocus(activeFocusFixture({ source: 'coach', catalogue: null, unverified: true }));
    expect(screen.getByRole('heading', { name: "Your coach's focus" })).toBeInTheDocument();
  });

  test('heads a catalogue-less self focus as the player\u2019s own', () => {
    renderActiveFocus(activeFocusFixture({ catalogue: null }));
    expect(screen.getByRole('heading', { name: 'Your focus' })).toBeInTheDocument();
  });

  test('hands the change request to the page', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    const history = createMemoryHistory();
    const router = createAppRouter({ history, queryClient });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          <ActiveFocusView focus={activeFocusFixture()} catalogue={[]} onChange={onChange} />
        </RouterContextProvider>
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Change focus' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('reads a flat verdict as flat, never as a direction it does not have', () => {
    renderActiveFocus(
      activeFocusFixture({
        measurements: [
          {
            stream: 'tournament',
            measuredAt: '2026-08-16T00:00:00.000Z',
            windowGames: 10,
            baselineValue: 0.5,
            currentValue: 0.5,
            unit: 'share converted',
            trend: 'flat',
            gamesToGo: 0,
          },
        ],
      }),
    );
    expect(screen.getByText(/Flat/)).toBeInTheDocument();
    expect(screen.getByText('→')).toBeInTheDocument();
    expect(screen.getAllByText(/0\.5 → 0\.5 share converted/)).toHaveLength(2);
  });

  test('reads a declining verdict as declining', () => {
    renderActiveFocus(
      activeFocusFixture({
        measurements: [
          {
            stream: 'tournament',
            measuredAt: '2026-08-16T00:00:00.000Z',
            windowGames: 10,
            baselineValue: 0.6,
            currentValue: 0.4,
            unit: 'share converted',
            trend: 'declining',
            gamesToGo: 0,
          },
        ],
      }),
    );
    expect(screen.getByText(/Declining/)).toBeInTheDocument();
    expect(screen.getByText('↓')).toBeInTheDocument();
  });

  test('counts one remaining game in the singular', () => {
    renderActiveFocus(
      activeFocusFixture({
        measurements: [
          {
            stream: 'online',
            measuredAt: '2026-08-16T00:00:00.000Z',
            windowGames: 1,
            baselineValue: null,
            currentValue: null,
            unit: 'share converted',
            trend: 'insufficient_evidence',
            gamesToGo: 1,
          },
        ],
      }),
    );
    expect(screen.getByText('1 more game to go.')).toBeInTheDocument();
  });

  test('measures a single-game window in the singular', () => {
    renderActiveFocus(
      activeFocusFixture({
        measurements: [
          {
            stream: 'tournament',
            measuredAt: '2026-08-16T00:00:00.000Z',
            windowGames: 1,
            baselineValue: 0.6,
            currentValue: 0.7,
            unit: 'share converted',
            trend: 'improving',
            gamesToGo: 0,
          },
        ],
      }),
    );
    expect(screen.getByText(/Measured over 1 game\./)).toBeInTheDocument();
  });
});

const meFixture: Me = {
  userId: 'user-1',
  email: 'player@example.com',
  name: 'Player',
  tier: 'beginner',
  player: {
    id: playerId,
    displayName: 'Mina',
    birthYear: 2013,
    fideId: null,
    fideRating: null,
    uscfId: null,
    uscfRating: null,
    chesscomUsername: null,
    lichessUsername: null,
    chesscomRating: null,
    lichessRating: null,
    currentStreak: 0,
    xp: 0,
    level: 1,
    createdAt: '2026-08-14T00:00:00.000Z',
  },
};

function renderFocusRoute(path = '/focus') {
  const history = createMemoryHistory({ initialEntries: [path] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

describe('FocusRoute', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    // The choice view's ranking section reads the report; keep it refused so
    // no test exercises the network by accident.
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'Not found.'),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('holds the skeleton while the focus queries resolve', async () => {
    vi.spyOn(focusApi, 'getFocus').mockReturnValue(Promise.withResolvers<ActiveFocus>().promise);
    vi.spyOn(focusApi, 'listFocuses').mockReturnValue(
      Promise.withResolvers<FocusCatalogueEntry[]>().promise,
    );
    renderFocusRoute();
    expect(await screen.findByRole('status', { name: 'Loading focus' })).toBeVisible();
  });

  test('renders the paid boundary when the focus requires an upgrade', async () => {
    vi.spyOn(focusApi, 'getFocus').mockRejectedValue(
      new ApiRequestError(402, 'upgrade_required', undefined, 'Upgrade required.'),
    );
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([convertingWon]);
    renderFocusRoute();
    expect(
      await screen.findByRole('heading', { name: 'Your focus is part of the paid loop' }),
    ).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Set your focus' })).not.toBeInTheDocument();
  });

  test('shows the retry empty state when the focus cannot be loaded', async () => {
    vi.spyOn(focusApi, 'getFocus').mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Boom.'),
    );
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([]);
    renderFocusRoute();
    expect(
      await screen.findByRole('heading', { name: 'Your focus could not be loaded' }),
    ).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Set your focus' })).not.toBeInTheDocument();
  });

  test('offers the catalogue when no focus is set', async () => {
    vi.spyOn(focusApi, 'getFocus').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No focus.'),
    );
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([convertingWon, tacticalAlertness]);
    renderFocusRoute();
    expect(await screen.findByRole('heading', { name: 'Set your focus' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Set Converting won positions' }),
    ).toBeInTheDocument();
  });

  test('keeps the page honest when the catalogue itself fails', async () => {
    vi.spyOn(focusApi, 'getFocus').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No focus.'),
    );
    vi.spyOn(focusApi, 'listFocuses').mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Boom.'),
    );
    renderFocusRoute();
    expect(
      await screen.findByText('The focus catalogue could not be loaded right now. Try again.'),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Set / })).not.toBeInTheDocument();
    expect(screen.queryByText('A focus from your coach')).not.toBeInTheDocument();
  });

  test('shows the active focus and reopens the choice view to replace it', async () => {
    const user = userEvent.setup();
    vi.spyOn(focusApi, 'getFocus').mockResolvedValue(activeFocusFixture());
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([convertingWon]);
    renderFocusRoute();
    expect(await screen.findByRole('heading', { name: 'Converting won positions' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Change focus' }));
    expect(await screen.findByRole('heading', { name: 'Set your focus' })).toBeVisible();
    expect(
      screen.getByText('Setting a new focus ends your current one: Converting won positions.'),
    ).toBeInTheDocument();
  });

  test('sets a focus, reports it, and shows it after the refetch', async () => {
    const user = userEvent.setup();
    vi.spyOn(focusApi, 'getFocus')
      .mockRejectedValueOnce(new ApiRequestError(404, 'not_found', undefined, 'No focus.'))
      .mockResolvedValue(activeFocusFixture());
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([convertingWon]);
    const setFocus = vi.spyOn(focusApi, 'setFocus').mockResolvedValue(activeFocusFixture());
    renderFocusRoute();
    await user.click(await screen.findByRole('button', { name: 'Set Converting won positions' }));
    expect(setFocus).toHaveBeenCalledWith({
      source: 'self',
      catalogueKey: 'converting_won_positions',
    });
    expect(vi.mocked(track)).toHaveBeenCalledWith('focus_set', {
      source: 'self',
      catalogueKey: 'converting_won_positions',
    });
    // The invalidation refetched the focus; the active view replaces the choice.
    expect(await screen.findByRole('heading', { name: 'Converting won positions' })).toBeVisible();
  });

  test('sets a coach focus from the instruction form and reports it', async () => {
    const user = userEvent.setup();
    vi.spyOn(focusApi, 'getFocus').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No focus.'),
    );
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([tacticalAlertness]);
    const setFocus = vi.spyOn(focusApi, 'setFocus').mockResolvedValue(activeFocusFixture());
    renderFocusRoute();
    await user.type(await screen.findByLabelText('Coach instruction'), 'Work on the clock.');
    await user.selectOptions(
      screen.getByLabelText('Paired measurable focus'),
      'tactical_alertness',
    );
    await user.click(screen.getByRole('button', { name: 'Set coach focus' }));
    expect(setFocus).toHaveBeenCalledWith({
      source: 'coach',
      coachInstruction: 'Work on the clock.',
      pairedCatalogueKey: 'tactical_alertness',
    });
    // A coach focus has no catalogue key to report.
    expect(vi.mocked(track)).toHaveBeenCalledWith('focus_set', { source: 'coach' });
  });

  test('maps a forbidden focus to an inline error and stays on the choice', async () => {
    const user = userEvent.setup();
    vi.spyOn(focusApi, 'getFocus').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No focus.'),
    );
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([convertingWon]);
    vi.spyOn(focusApi, 'setFocus').mockRejectedValue(
      new ApiRequestError(403, 'forbidden', undefined, 'No.'),
    );
    renderFocusRoute();
    await user.click(await screen.findByRole('button', { name: 'Set Converting won positions' }));
    expect(await screen.findByText('This focus cannot be set for this player.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Set your focus' })).toBeVisible();
  });

  test('sends the player back to the catalogue when the focus is retired', async () => {
    const user = userEvent.setup();
    vi.spyOn(focusApi, 'getFocus').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No focus.'),
    );
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([convertingWon]);
    vi.spyOn(focusApi, 'setFocus').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'Gone.'),
    );
    renderFocusRoute();
    await user.click(await screen.findByRole('button', { name: 'Set Converting won positions' }));
    expect(
      await screen.findByText('That focus is no longer available. Choose another.'),
    ).toBeVisible();
  });

  test('maps an unknown failure to the retry copy', async () => {
    const user = userEvent.setup();
    vi.spyOn(focusApi, 'getFocus').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No focus.'),
    );
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([convertingWon]);
    vi.spyOn(focusApi, 'setFocus').mockRejectedValue(new Error('502'));
    renderFocusRoute();
    await user.click(await screen.findByRole('button', { name: 'Set Converting won positions' }));
    expect(await screen.findByText('The focus could not be set. Please try again.')).toBeVisible();
  });

  test('returns to sign-in when the session expired mid-choice', async () => {
    const user = userEvent.setup();
    vi.spyOn(focusApi, 'getFocus').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No focus.'),
    );
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([convertingWon]);
    vi.spyOn(focusApi, 'setFocus').mockRejectedValue(
      new ApiRequestError(401, 'unauthorized', undefined, 'Expired.'),
    );
    const { router } = renderFocusRoute();
    await user.click(await screen.findByRole('button', { name: 'Set Converting won positions' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/sign-in');
    });
  });

  test('switches the ranking stream through the URL', async () => {
    const user = userEvent.setup();
    vi.spyOn(focusApi, 'getFocus').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No focus.'),
    );
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([]);
    const { router } = renderFocusRoute();
    await user.click(await screen.findByRole('radio', { name: 'Online' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ stream: 'online' });
    });
  });
});

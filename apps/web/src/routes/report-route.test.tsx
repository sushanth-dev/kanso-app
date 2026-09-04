import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider, RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { track } from '../analytics.ts';

vi.mock('../analytics.ts', () => ({
  safeProperties: (properties: Record<string, string | number>) => properties,
  track: vi.fn(),
}));
import { accountApi, ApiRequestError, type Me } from '../api/account-api.ts';
import {
  diagnosisApi,
  type ActionItem,
  type GameSummary,
  type Report,
  type WeaknessCoaching,
} from '../api/diagnosis-api.ts';
import { tournamentApi, type TournamentSummary } from '../api/tournament-api.ts';
import { createAppRouter } from '../router.tsx';
import { ReportScreen } from './report-route.tsx';

function tournamentFixture(overrides: Partial<TournamentSummary> = {}): TournamentSummary {
  return {
    id: '00000000-0000-4000-8000-0000000000d1',
    name: 'City Open',
    site: 'Columbus',
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-02T00:00:00.000Z',
    gameCount: 6,
    analysedCount: 6,
    ...overrides,
  };
}

const playerId = '00000000-0000-4000-8000-000000000001';

const evidenceInstance = {
  gameId: '00000000-0000-4000-8000-0000000000ab',
  whiteName: 'Mina',
  blackName: 'Opponent',
  playedAt: '2026-08-14T00:00:00.000Z',
  moveNumber: 23,
  ply: 45,
  moveSan: 'Nf6',
  bestMoveSan: 'e5',
  phase: 'middlegame' as const,
  judgement: 'mistake' as const,
  cpLoss: 240,
};

/** ST-107. One assigned resource; the curriculum the coach closes per item. */
function actionItemFixture(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    id: 'ai-1',
    resourceIndex: 1,
    tier: 'beginner',
    resource: '[Beginner] Laszlo Polgar - Chess: 5334 Problems, problems #1800-#1900',
    status: 'pending',
    dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    completedAt: null,
    ...overrides,
  };
}

const motifWeakness = {
  id: 'w-1',
  kind: 'motif' as const,
  label: 'Missed captures',
  eco: null,
  ratingLeak: 34,
  saturated: false,
  halfPointsLost: 2.5,
  gamesAffected: 6,
  occurrences: 9,
  rank: 1,
  advice: 'After every opponent move, count what each available capture wins.',
  actionItems: [actionItemFixture()],
  drilled: 0,
  groupKey: 'missed_capture',
  evidence: [evidenceInstance],
};

const openingWeakness = {
  id: 'w-2',
  kind: 'opening' as const,
  label: 'Sicilian, Alapin',
  eco: 'B22',
  ratingLeak: 21,
  saturated: false,
  halfPointsLost: 1.5,
  gamesAffected: 4,
  occurrences: 5,
  rank: 2,
  advice: null,
  actionItems: [],
  drilled: 0,
  groupKey: 'B22',
  evidence: [],
};

function reportFixture(overrides: Partial<Report> = {}): Report {
  return {
    id: 'report-1',
    playerId,
    stream: 'tournament',
    tournamentId: null,
    generatedAt: '2026-08-15T12:00:00.000Z',
    gamesCovered: 12,
    windowStart: '2025-09-01T00:00:00.000Z',
    windowEnd: '2026-05-31T00:00:00.000Z',
    timeTroubleFromMove: null,
    timeTroubleReason: null,
    weaknesses: [motifWeakness, openingWeakness],
    narrative: null,
    ...overrides,
  };
}

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

function gameFixture(overrides: Partial<GameSummary> = {}): GameSummary {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    stream: 'online',
    source: 'chesscom',
    playerColor: 'white',
    result: '1-0',
    playedAt: '2026-08-14T00:00:00.000Z',
    event: null,
    round: null,
    board: null,
    whiteName: 'Mina',
    blackName: 'Opponent',
    whiteElo: null,
    blackElo: null,
    eco: null,
    opening: null,
    moveCount: 40,
    hasClockData: false,
    analysisStatus: 'pending',
    analyzedAt: null,
    ...overrides,
  };
}

const reportNotFound = new ApiRequestError(404, 'not_found', undefined, 'Not found.');

function renderReport(report: Report, analyzingGames: GameSummary[] = []) {
  const user = userEvent.setup();
  const history = createMemoryHistory();
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <ReportScreen
          stream={report.stream}
          report={report}
          onStreamChange={vi.fn()}
          analyzingGames={analyzingGames}
        />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
  return { user, queryClient };
}

describe('ReportScreen', () => {
  test('renders the ranked list with the coverage meta', () => {
    renderReport(reportFixture());
    expect(
      screen.getByRole('heading', { level: 1, name: 'Tournament report' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Missed captures')).toBeVisible();
    expect(screen.getByText(/covering 12 games/)).toBeVisible();
  });

  test('labels a saturated leak as a floor', () => {
    renderReport(
      reportFixture({
        weaknesses: [{ ...motifWeakness, saturated: true }],
      }),
    );
    expect(screen.getByText('at least 34')).toBeVisible();
  });

  test('shows the places and the advice behind a weakness', async () => {
    // Spies are not auto-restored in this file: drop the earlier tests' calls.
    const coachWeakness = vi.spyOn(diagnosisApi, 'coachWeakness').mockClear().mockResolvedValue({
      advice: motifWeakness.advice,
      actionItems: motifWeakness.actionItems,
    });
    const { user } = renderReport(reportFixture());
    await user.click(screen.getByText('Show evidence'));

    // The click opened the weakness: the coaching endpoint ran once.
    await waitFor(() => {
      expect(coachWeakness).toHaveBeenCalledWith({ weaknessId: 'w-1' });
    });
    // The advice: what to do about the weakness.
    expect(screen.getByText(/count what each available capture wins/)).toBeVisible();
    // The place: the move played, the move that was better, and the way in.
    const item = screen.getByText(/e5 was better/).closest('li');
    expect(item).toHaveTextContent('Move');
    expect(item).toHaveTextContent('23');
    expect(item).toHaveTextContent('Nf6');
    expect(item).toHaveTextContent('240');
    expect(screen.getByRole('link', { name: 'Review game' }).getAttribute('href')).toBe(
      `/games/${evidenceInstance.gameId}?ply=${evidenceInstance.ply}`,
    );
  });

  test('opens no plan block while the narrative is unwritten', () => {
    renderReport(reportFixture());
    expect(screen.queryByText('what to do')).toBeNull();
  });

  test('renders the model-written plan above the cards', () => {
    renderReport(
      reportFixture({
        narrative: 'Start with the missed captures: count defenders after every opponent move.',
      }),
    );
    expect(screen.getByText(/Start with the missed captures: count defenders/)).toBeVisible();
  });

  test('an opening weakness offers its resources, not the evidence expander', () => {
    renderReport(
      reportFixture({
        weaknesses: [openingWeakness],
      }),
    );
    expect(screen.getByText('Sicilian, Alapin')).toBeVisible();
    expect(screen.queryByText('Show evidence')).toBeNull();
    expect(screen.getByText('Get resources')).toBeVisible();
  });

  test('a click writes the coaching once; reopening the weakness never re-asks', async () => {
    // Spies are not auto-restored in this file: drop the earlier tests' calls.
    const coachWeakness = vi
      .spyOn(diagnosisApi, 'coachWeakness')
      .mockClear()
      .mockResolvedValue({
        advice: 'Count defenders before every capture; nine losses were hanging pieces.',
        actionItems: [actionItemFixture()],
      });
    const { user } = renderReport(reportFixture());
    await user.click(screen.getByText('Show evidence'));

    // The answer lands and the note hint goes away.
    await waitFor(() => {
      expect(screen.queryByText('The coach is writing your note...')).toBeNull();
    });
    expect(coachWeakness).toHaveBeenCalledTimes(1);

    // Opening the weakness again does not re-ask.
    await user.click(screen.getByText('Hide evidence'));
    await user.click(screen.getByText('Show evidence'));
    expect(coachWeakness).toHaveBeenCalledTimes(1);
  });

  test('names the analysing games as a numbered list', () => {
    renderReport(reportFixture(), [
      gameFixture({ id: 'g-1', analysisStatus: 'analyzing' }),
      gameFixture({ id: 'g-2', analysisStatus: 'queued' }),
    ]);
    const banner = screen.getByRole('status', { name: 'Analyzing games' });
    expect(banner).toBeVisible();
    expect(banner).toHaveTextContent('Analyzing 2 games:');
    const list = banner.querySelector('ol');
    expect(list?.children).toHaveLength(2);
    expect(list?.children[0]).toHaveTextContent('Mina vs Opponent');
    expect(list?.children[1]).toHaveTextContent('Mina vs Opponent');
  });

  test('states the time-trouble onset, or why it is absent', () => {
    renderReport(reportFixture({ timeTroubleFromMove: 31, timeTroubleReason: null }));
    expect(screen.getByText(/Time trouble starts around move/)).toBeVisible();

    renderReport(reportFixture({ timeTroubleFromMove: null, timeTroubleReason: 'no_clock_data' }));
    expect(screen.getByText(/No clock data on these games/)).toBeVisible();
  });

  test('ST-106: offers the group puzzle drill on a weakness card', () => {
    renderReport(reportFixture());
    // One entry per card; the ranked list leads with the motif weakness.
    const links = screen.getAllByRole('link', { name: 'Practice puzzles' });
    expect(links[0]!.getAttribute('href')).toBe(
      `/practice?kind=motif&group=${encodeURIComponent('missed_capture')}&label=${encodeURIComponent('Missed captures')}&stream=tournament`,
    );
  });

  test('ST-106: marks a weakness whose full drill set is solved', () => {
    renderReport(
      reportFixture({
        weaknesses: [{ ...motifWeakness, drilled: 20 }],
      }),
    );
    expect(screen.getByText('Practiced')).toBeVisible();
    // ST-107: the first deal done, the card names the next one.
    expect(screen.getByRole('link', { name: 'Practice more puzzles' })).toBeInTheDocument();
  });

  test('ST-106: a partly drilled weakness carries no practised mark yet', () => {
    renderReport(
      reportFixture({
        weaknesses: [{ ...motifWeakness, drilled: 7 }],
      }),
    );
    expect(screen.queryByText('Practiced')).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Practice puzzles' }).length).toBeGreaterThan(0);
  });
  test('ST-111: the weakness card links to the curriculum instead of listing items', () => {
    renderReport(reportFixture());
    // The items exist, but the card shows the link, never the list.
    expect(screen.queryByText(/Laszlo Polgar/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take assessment' })).toBeNull();
    expect(screen.getByRole('link', { name: 'View curriculum' })).toHaveAttribute(
      'href',
      '/curriculum',
    );
  });
  test('says honestly when the report carries no weaknesses yet', () => {
    renderReport(reportFixture({ weaknesses: [], gamesCovered: 3 }));
    expect(screen.getByRole('heading', { name: 'Not enough evidence to rank yet' })).toBeVisible();
    expect(screen.getByText(/from your 3 games/)).toBeVisible();
    expect(screen.queryByText('Show evidence')).toBeNull();
  });

  test('shows the leak floor away from the top rank too', () => {
    renderReport(reportFixture({ weaknesses: [{ ...motifWeakness, saturated: true, rank: 2 }] }));
    expect(screen.getByText('at least 34')).toBeVisible();
  });

  test('names the ECO beside an opening weakness', () => {
    renderReport(reportFixture({ weaknesses: [openingWeakness] }));
    expect(screen.getByText('B22')).toBeVisible();
  });

  test('admits when a weakness has no individual positions to show', async () => {
    const { user } = renderReport(
      reportFixture({ weaknesses: [{ ...motifWeakness, evidence: [] }] }),
    );
    await user.click(screen.getByText('Show evidence'));
    expect(screen.getByText('No individual positions to show yet.')).toBeVisible();
  });

  test('keeps the template copy when the coaching fails, and retries on reopen', async () => {
    const coachWeakness = vi
      .spyOn(diagnosisApi, 'coachWeakness')
      .mockClear()
      .mockRejectedValueOnce(new Error('502'))
      .mockResolvedValue({ advice: 'Count defenders.', actionItems: [] });
    const { user } = renderReport(reportFixture());
    await user.click(screen.getByText('Show evidence'));
    await waitFor(() => {
      expect(coachWeakness).toHaveBeenCalledTimes(1);
    });
    // The evidence stays open; the failure is silent, the template stands.
    expect(screen.getByText(/count what each available capture wins/)).toBeVisible();
    expect(screen.queryByText('The coach is writing your note...')).toBeNull();

    await user.click(screen.getByText('Hide evidence'));
    await user.click(screen.getByText('Show evidence'));
    await waitFor(() => {
      expect(coachWeakness).toHaveBeenCalledTimes(2);
    });
  });

  test('names the resources as being written while an opening asks for them', async () => {
    vi.spyOn(diagnosisApi, 'coachWeakness')
      .mockClear()
      .mockReturnValue(Promise.withResolvers<WeaknessCoaching>().promise);
    const { user } = renderReport(reportFixture({ weaknesses: [openingWeakness] }));
    await user.click(screen.getByText('Get resources'));
    expect(screen.getByText('Writing your resources...')).toBeVisible();
    // The opening never gets the evidence expander, even expanded.
    expect(screen.queryByRole('button', { name: 'Hide evidence' })).toBeNull();
  });

  test('counts one analysing game in the singular', () => {
    renderReport(reportFixture(), [gameFixture({ id: 'g-1', analysisStatus: 'analyzing' })]);
    const banner = screen.getByRole('status', { name: 'Analyzing games' });
    expect(banner).toHaveTextContent('Analyzing 1 game:');
    expect(banner.querySelector('ol')?.children).toHaveLength(1);
  });

  test('explains missing time trouble from thin clock evidence', () => {
    renderReport(
      reportFixture({
        timeTroubleFromMove: null,
        timeTroubleReason: 'not_enough_evidence',
      }),
    );
    expect(screen.getByText('Too few games with clock data to measure time usage.')).toBeVisible();
  });

  test('offers no actions when a weakness has no drill group', () => {
    renderReport(
      reportFixture({
        weaknesses: [
          {
            ...motifWeakness,
            kind: 'time_trouble',
            groupKey: null,
            eco: null,
            advice: null,
            actionItems: [],
          },
        ],
      }),
    );
    expect(screen.getByText('Time trouble')).toBeVisible();
    expect(screen.queryByText('Show evidence')).toBeNull();
    expect(screen.queryByText('Get resources')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Practice puzzles' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'View curriculum' })).toBeNull();
  });
});

function renderRoute(path = '/report?stream=online') {
  const history = createMemoryHistory({ initialEntries: [path] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('ReportRoute', () => {
  beforeEach(() => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('links to import from the no-games empty state', async () => {
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(reportNotFound);
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [],
      total: 0,
      page: 1,
      limit: 100,
    });

    renderRoute();

    expect(
      await screen.findByRole('heading', { name: 'No analyzed games in this stream yet' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Import games' })).toHaveAttribute('href', '/import');
  });

  test('keeps showing the report with a numbered banner while a game analyses', async () => {
    vi.spyOn(diagnosisApi, 'getReport').mockResolvedValue(
      reportFixture({ stream: 'online', gamesCovered: 1 }),
    );
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [
        gameFixture({ id: 'g-1', analysisStatus: 'analyzing' }),
        gameFixture({ id: 'g-2', analysisStatus: 'complete' }),
      ],
      total: 2,
      page: 1,
      limit: 100,
    });

    renderRoute();

    // The report is visible, not replaced by an analysing screen.
    expect(await screen.findByRole('heading', { name: 'Online report' })).toBeVisible();
    // The banner lists the game still analysing, numbered.
    const banner = await screen.findByRole('status', { name: 'Analyzing games' });
    const list = banner.querySelector('ol');
    expect(list?.children).toHaveLength(1);
    expect(list?.children[0]).toHaveTextContent('Mina vs Opponent');
  });

  test('a click writes the model line into the served report once', async () => {
    vi.spyOn(diagnosisApi, 'getReport').mockResolvedValue(
      reportFixture({
        stream: 'online',
        weaknesses: [{ ...motifWeakness, advice: null, actionItems: [] }],
      }),
    );
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [gameFixture({ id: 'g-1', analysisStatus: 'complete' })],
      total: 1,
      page: 1,
      limit: 100,
    });
    const coachWeakness = vi
      .spyOn(diagnosisApi, 'coachWeakness')
      .mockClear()
      .mockResolvedValue({
        advice: 'Count defenders before every capture; nine losses were hanging pieces.',
        actionItems: [actionItemFixture()],
      });

    renderRoute();

    // The card carries no advice line until the click opens the weakness.
    expect(await screen.findByText('Missed captures')).toBeVisible();
    expect(screen.queryByText(/count what each available capture wins/)).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByText('Show evidence'));

    // The answer lands in the served report: the patch rewrote the cached
    // report, advice line and curriculum together, and the model ran once.
    expect(await screen.findByText(/Count defenders before every capture/)).toBeVisible();
    // ST-111: the patch lands the items in the cache, and the card answers
    // with the curriculum link, not the list.
    expect(screen.getByRole('link', { name: 'View curriculum' })).toHaveAttribute(
      'href',
      '/curriculum',
    );
    expect(coachWeakness).toHaveBeenCalledTimes(1);
  });

  test('polls and swaps to the report once every game is analysed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getReport = vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(reportNotFound);
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [gameFixture({ id: 'g-1', analysisStatus: 'analyzing' })],
      total: 1,
      page: 1,
      limit: 100,
    });

    renderRoute();
    expect(await screen.findByText('0 of 1 game analysed')).toBeVisible();

    getReport.mockResolvedValue(reportFixture({ stream: 'online', gamesCovered: 1 }));
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [gameFixture({ id: 'g-1', analysisStatus: 'complete' })],
      total: 1,
      page: 1,
      limit: 100,
    });

    await vi.advanceTimersByTimeAsync(5000);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Online report' })).toBeVisible();
    });
  });

  test('scopes the analysing counter to the current upload when game ids are present', async () => {
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(reportNotFound);
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [
        gameFixture({ id: 'g-1', analysisStatus: 'analyzing' }),
        gameFixture({ id: 'g-2', analysisStatus: 'analyzing' }),
        gameFixture({ id: 'g-3', analysisStatus: 'complete' }),
      ],
      total: 3,
      page: 1,
      limit: 100,
    });

    renderRoute('/report?stream=online&gameIds=g-2&gameIds=g-3');

    // The old batch (g-1) does not enter the count.
    expect(await screen.findByText('1 of 2 games analysed')).toBeVisible();
  });

  test('lists every analysing game in the counter, numbered', async () => {
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(reportNotFound);
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: ['g-1', 'g-2', 'g-3', 'g-4', 'g-5'].map((id) =>
        gameFixture({ id, analysisStatus: 'analyzing' }),
      ),
      total: 5,
      page: 1,
      limit: 100,
    });

    renderRoute(
      '/report?stream=online&gameIds=g-1&gameIds=g-2&gameIds=g-3&gameIds=g-4&gameIds=g-5',
    );

    const counter = await screen.findByText('0 of 5 games analysed');
    // ST-098: a numbered list of all five, not an inline run capped at three.
    const list = counter.nextElementSibling;
    expect(list?.tagName).toBe('OL');
    expect(list?.children).toHaveLength(5);
    expect(list?.children[4]).toHaveTextContent('Mina vs Opponent');
  });

  test('answers 422 with the honest thin-history state, not the import nudge', async () => {
    // ST-095: analysed games below the rated threshold used to share the
    // zero-games 404, telling a player with games to import games.
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(
      new ApiRequestError(
        422,
        'not_enough_evidence',
        undefined,
        'Only 3 of the 3 analyzed games in this stream count toward a report. A report needs 6 rated games in the last year.',
      ),
    );
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [gameFixture({ id: 'g-1', analysisStatus: 'complete' })],
      total: 1,
      page: 1,
      limit: 100,
    });

    renderRoute();

    expect(
      await screen.findByRole('heading', { name: 'Not enough rated games for a report yet' }),
    ).toBeVisible();
    expect(screen.getByText(/3 analyzed games in this stream/)).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'No analyzed games in this stream yet' })).toBe(
      null,
    );
  });

  test('points colourless pending games at the games list instead of the spinner', async () => {
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(reportNotFound);
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [
        gameFixture({ id: 'g-1', playerColor: null, analysisStatus: 'pending' }),
        gameFixture({ id: 'g-2', playerColor: null, analysisStatus: 'pending' }),
      ],
      total: 2,
      page: 1,
      limit: 100,
    });

    renderRoute();

    expect(
      await screen.findByRole('heading', { name: '2 games need your side before analysis' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Games' })).toHaveAttribute('href', '/games');
    expect(screen.queryByText('This report will appear as soon as it is ready.')).toBeNull();
  });

  test('names the needs-side games inside the analysing screen', async () => {
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(reportNotFound);
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [
        gameFixture({ id: 'g-1', analysisStatus: 'analyzing' }),
        gameFixture({ id: 'g-2', playerColor: null, analysisStatus: 'pending' }),
      ],
      total: 2,
      page: 1,
      limit: 100,
    });

    renderRoute();

    expect(await screen.findByText('0 of 2 games analysed')).toBeVisible();
    expect(screen.getByText(/1 game needs your side before analysis can start/)).toBeVisible();
  });

  test('shows the analysing screen over the thin-history refusal while a game runs', async () => {
    // ST-096: the report endpoint flips from 404 to 422 the moment one game
    // completes, and the refusal must not preempt the batch still analysing.
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(
      new ApiRequestError(
        422,
        'not_enough_evidence',
        undefined,
        '1 analyzed game in this stream, but a report needs 6 rated games in the last year.',
      ),
    );
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [
        gameFixture({ id: 'g-1', analysisStatus: 'complete' }),
        gameFixture({ id: 'g-2', analysisStatus: 'analyzing' }),
      ],
      total: 2,
      page: 1,
      limit: 100,
    });

    renderRoute();

    expect(await screen.findByText('1 of 2 games analysed')).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Not enough rated games for a report yet' }),
    ).toBeNull();
  });

  test('the tournament stream is a directory: cards open each tournament report', async () => {
    vi.spyOn(tournamentApi, 'listTournaments').mockResolvedValue({
      tournaments: [tournamentFixture({ gameCount: 7, analysedCount: 7 })],
    });
    const getReport = vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(reportNotFound);
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [],
      total: 0,
      page: 1,
      limit: 100,
    });

    renderRoute('/report?stream=tournament');

    expect(await screen.findByText('City Open')).toBeVisible();
    // ST-098: the card opens the tournament's own report, not the detail page.
    expect(screen.getByRole('link', { name: 'Open report' })).toHaveAttribute(
      'href',
      '/report?stream=tournament&tournamentId=00000000-0000-4000-8000-0000000000d1',
    );
    // The directory carries no blended weakness list of its own.
    expect(screen.queryByText('Missed captures')).toBeNull();
    expect(getReport.mock.calls.every(([, tournamentId]) => tournamentId === undefined)).toBe(true);
  });

  test('greys a tournament card out and disables it under six games', async () => {
    vi.spyOn(tournamentApi, 'listTournaments').mockResolvedValue({
      tournaments: [tournamentFixture({ gameCount: 5, analysedCount: 3 })],
    });
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(reportNotFound);
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [],
      total: 0,
      page: 1,
      limit: 100,
    });

    renderRoute('/report?stream=tournament');

    expect(await screen.findByText('City Open')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open report' })).toBeDisabled();
    expect(screen.getByText('A report needs 6 games; this tournament has 5.')).toBeVisible();
  });

  test('never shows the tournament cards on the online stream', async () => {
    vi.spyOn(tournamentApi, 'listTournaments').mockResolvedValue({
      tournaments: [tournamentFixture()],
    });
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(reportNotFound);
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [],
      total: 0,
      page: 1,
      limit: 100,
    });

    renderRoute('/report?stream=online');

    expect(
      await screen.findByRole('heading', { name: 'No analyzed games in this stream yet' }),
    ).toBeVisible();
    expect(screen.queryByText('City Open')).toBeNull();
  });

  test('renders one card per tournament, each gated on its own count', async () => {
    vi.spyOn(tournamentApi, 'listTournaments').mockResolvedValue({
      tournaments: [
        tournamentFixture({ gameCount: 7, analysedCount: 7 }),
        tournamentFixture({
          id: '00000000-0000-4000-8000-0000000000d2',
          name: 'Rapid Monday',
          gameCount: 2,
          analysedCount: 2,
        }),
      ],
    });
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(reportNotFound);
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [],
      total: 0,
      page: 1,
      limit: 100,
    });

    renderRoute('/report?stream=tournament');

    expect(await screen.findByText('City Open')).toBeVisible();
    expect(screen.getByText('Rapid Monday')).toBeVisible();
    // Seven games: the link works. Two: the card greys out with its own reason.
    expect(screen.getByRole('link', { name: 'Open report' })).toHaveAttribute(
      'href',
      '/report?stream=tournament&tournamentId=00000000-0000-4000-8000-0000000000d1',
    );
    expect(screen.getByRole('button', { name: 'Open report' })).toBeDisabled();
    expect(screen.getByText('A report needs 6 games; this tournament has 2.')).toBeVisible();
  });

  test('drops the tournament cards when the stream switches to online from a warm cache', async () => {
    // ST-097 regression: `enabled: false` keeps the tournaments cache alive,
    // and the ungated card list carried it onto the online stream until a
    // refresh. The stream gate, not the query, must decide.
    const user = userEvent.setup();
    vi.spyOn(tournamentApi, 'listTournaments').mockResolvedValue({
      tournaments: [tournamentFixture({ gameCount: 2, analysedCount: 2 })],
    });
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(reportNotFound);
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [],
      total: 0,
      page: 1,
      limit: 100,
    });

    renderRoute('/report?stream=tournament');
    expect(await screen.findByText('City Open')).toBeVisible();

    await user.click(screen.getByRole('radio', { name: 'Online' }));

    expect(
      await screen.findByRole('heading', { name: 'No analyzed games in this stream yet' }),
    ).toBeVisible();
    expect(screen.queryByText('City Open')).toBeNull();
  });

  test('a scoped tournament report heads itself with the tournament name and passes the scope', async () => {
    const cityOpen = '00000000-0000-4000-8000-0000000000d1';
    vi.spyOn(tournamentApi, 'listTournaments').mockResolvedValue({
      tournaments: [tournamentFixture()],
    });
    const getReport = vi
      .spyOn(diagnosisApi, 'getReport')
      .mockResolvedValue(reportFixture({ stream: 'tournament', tournamentId: cityOpen }));
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [],
      total: 6,
      page: 1,
      limit: 100,
    });

    renderRoute(`/report?stream=tournament&tournamentId=${cityOpen}`);

    // The tournament's own report, headed by the tournament's own name.
    expect(await screen.findByRole('heading', { level: 1, name: 'City Open' })).toBeVisible();
    expect(getReport).toHaveBeenCalledWith('tournament', cityOpen);
    expect(screen.getByText(/covering 12 games/)).toBeVisible();
  });

  test('the tournaments page keeps its detail link', async () => {
    // TournamentCard is shared; its default action is unchanged.
    vi.spyOn(tournamentApi, 'listTournaments').mockResolvedValue({
      tournaments: [tournamentFixture({ gameCount: 7, analysedCount: 7 })],
    });
    const history = createMemoryHistory({ initialEntries: ['/tournaments'] });
    const queryClient = new QueryClient();
    const router = createAppRouter({ history, queryClient });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Open tournament' })).toHaveAttribute(
        'href',
        '/tournaments/00000000-0000-4000-8000-0000000000d1',
      );
    });
  });
  test('shows the retry empty state when the report fails for an unknown reason', async () => {
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Boom.'),
    );
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [],
      total: 0,
      page: 1,
      limit: 100,
    });

    renderRoute();

    expect(
      await screen.findByRole('heading', { name: 'The report could not be loaded' }),
    ).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'No analyzed games in this stream yet' })).toBe(
      null,
    );
  });

  test('records the report view once, when the report lands', async () => {
    vi.mocked(track).mockClear();
    vi.spyOn(diagnosisApi, 'getReport').mockResolvedValue(reportFixture({ stream: 'online' }));
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [gameFixture({ id: 'g-1', analysisStatus: 'complete' })],
      total: 1,
      page: 1,
      limit: 100,
    });

    renderRoute();
    await waitFor(() => {
      expect(vi.mocked(track)).toHaveBeenCalledWith('report_viewed', { stream: 'online' });
    });
    // The data object is stable once landed; the effect does not repeat.
    expect(vi.mocked(track)).toHaveBeenCalledTimes(1);
  });

  test('falls back to the stream heading when the tournament is not in the list', async () => {
    const missing = '00000000-0000-4000-8000-0000000000ff';
    const getReport = vi
      .spyOn(diagnosisApi, 'getReport')
      .mockResolvedValue(reportFixture({ stream: 'tournament', tournamentId: missing }));
    vi.spyOn(tournamentApi, 'listTournaments').mockResolvedValue({ tournaments: [] });
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [],
      total: 6,
      page: 1,
      limit: 100,
    });

    renderRoute(`/report?stream=tournament&tournamentId=${missing}`);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tournament report' }),
    ).toBeVisible();
    expect(getReport).toHaveBeenCalledWith('tournament', missing);
  });

  test('asks for the side on a single colourless game in the singular', async () => {
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(reportNotFound);
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [gameFixture({ id: 'g-1', playerColor: null, analysisStatus: 'pending' })],
      total: 1,
      page: 1,
      limit: 100,
    });

    renderRoute();

    expect(
      await screen.findByRole('heading', { name: '1 game needs your side before analysis' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Games' })).toHaveAttribute('href', '/games');
  });

  test('keeps the served advice when the coach returns no line, but lands the items', async () => {
    vi.spyOn(diagnosisApi, 'getReport').mockResolvedValue(
      reportFixture({
        stream: 'online',
        weaknesses: [{ ...motifWeakness, advice: 'The template line.', actionItems: [] }],
      }),
    );
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [gameFixture({ id: 'g-1', analysisStatus: 'complete' })],
      total: 1,
      page: 1,
      limit: 100,
    });
    vi.spyOn(diagnosisApi, 'coachWeakness')
      .mockClear()
      .mockResolvedValue({
        advice: null,
        actionItems: [actionItemFixture()],
      });

    renderRoute();
    const user = userEvent.setup();
    await user.click(await screen.findByText('Show evidence'));

    // A null line keeps the template copy; the items still land in the cache.
    expect(await screen.findByText('The template line.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'View curriculum' })).toBeVisible();
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider, RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { accountApi, ApiRequestError, type Me } from '../api/account-api.ts';
import {
  diagnosisApi,
  type ActionItem,
  type ActionItemDone,
  type GameSummary,
  type Report,
} from '../api/diagnosis-api.ts';
import { tournamentApi, type TournamentSummary } from '../api/tournament-api.ts';
import { createAppRouter } from '../router.tsx';
import { ME_QUERY_KEY } from '../query-client.ts';
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
    const { user } = renderReport(reportFixture());
    await user.click(screen.getByText('Show evidence'));

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

  test('opens no expander on an opening weakness', () => {
    renderReport(
      reportFixture({
        weaknesses: [openingWeakness],
      }),
    );
    expect(screen.getByText('Sicilian, Alapin')).toBeVisible();
    expect(screen.queryByText('Show evidence')).toBeNull();
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
  test('ST-107: lists a pending action item with its tier, resource, and an assessment link', () => {
    renderReport(reportFixture());
    // The tier tag is data for the badge, noise for the resource link.
    expect(screen.getByText('Beginner')).toBeVisible();
    const resourceName = 'Laszlo Polgar - Chess: 5334 Problems, problems #1800-#1900';
    expect(screen.getByRole('link', { name: resourceName }).getAttribute('href')).toBe(
      `https://www.google.com/search?q=${encodeURIComponent(resourceName)}`,
    );
    expect(screen.getByRole('button', { name: 'Take assessment' })).toBeInTheDocument();
  });

  test('ST-107: flags a pending action item past its due date', () => {
    renderReport(
      reportFixture({
        weaknesses: [
          {
            ...motifWeakness,
            actionItems: [
              actionItemFixture({ dueAt: new Date(Date.now() - 86_400_000).toISOString() }),
            ],
          },
        ],
      }),
    );
    expect(screen.getByText('Overdue')).toBeVisible();
  });

  test('ST-107: shows the done badge on a passed assessment', () => {
    const completedAt = '2026-08-31T10:00:00.000Z';
    renderReport(
      reportFixture({
        weaknesses: [
          {
            ...motifWeakness,
            actionItems: [actionItemFixture({ status: 'completed', completedAt })],
          },
        ],
      }),
    );
    expect(screen.getByText('Done (+100 XP)')).toBeVisible();
    const passedOn = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
      new Date(completedAt),
    );
    expect(screen.getByText(`Assessment passed ${passedOn}`)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Take assessment' })).toBeNull();
  });

  test('ST-107: a passed assessment refetches the report and the award caches', async () => {
    const { user, queryClient } = renderReport(reportFixture());
    let resolveCoach: (result: ActionItemDone) => void = () => {};
    const markActionItemDone = vi.spyOn(diagnosisApi, 'markActionItemDone').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCoach = resolve;
        }),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    await user.click(screen.getByRole('button', { name: 'Take assessment' }));
    expect(
      screen.getByRole('form', { name: 'Submit this resource assessment' }),
    ).toBeInTheDocument();
    await user.type(
      screen.getByLabelText('In your own words, what is the core idea of this concept?'),
      'Before every move, count what each available capture wins.',
    );
    await user.click(screen.getByRole('button', { name: 'Submit to the coach' }));

    // The coach is judging while the request runs.
    expect(await screen.findByText('The coach is thinking...')).toBeVisible();
    expect(markActionItemDone).toHaveBeenCalledWith({
      actionItemId: 'ai-1',
      summary: 'Before every move, count what each available capture wins.',
    });

    resolveCoach({
      pass: true,
      feedback: 'Exactly right.',
      completedAt: new Date().toISOString(),
    });
    await waitFor(() => {
      expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toEqual([
        ['report'],
        ['action-items'],
        ME_QUERY_KEY,
      ]);
    });
  });

  test('ST-107: a rejected assessment keeps the form open with the feedback', async () => {
    const { user } = renderReport(reportFixture());
    vi.spyOn(diagnosisApi, 'markActionItemDone').mockResolvedValue({
      pass: false,
      feedback: 'Name one concrete idea from the resource and why it matters.',
      completedAt: null,
    });

    await user.click(screen.getByRole('button', { name: 'Take assessment' }));
    await user.type(
      screen.getByLabelText('In your own words, what is the core idea of this concept?'),
      'Details here.',
    );
    await user.click(screen.getByRole('button', { name: 'Submit to the coach' }));

    expect(
      await screen.findByText('Name one concrete idea from the resource and why it matters.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Submit to the coach' })).toBeVisible();
  });

  test('ST-107: refuses an empty summary before calling the coach', async () => {
    const { user } = renderReport(reportFixture());
    const markActionItemDone = vi.spyOn(diagnosisApi, 'markActionItemDone').mockClear();

    await user.click(screen.getByRole('button', { name: 'Take assessment' }));
    await user.click(screen.getByRole('button', { name: 'Submit to the coach' }));

    expect(await screen.findByText('Write a short summary of the core idea first.')).toBeVisible();
    expect(markActionItemDone).not.toHaveBeenCalled();
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
});

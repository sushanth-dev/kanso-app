import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { accountApi, ApiRequestError, type Me } from '../api/account-api.ts';
import { diagnosisApi, type Report } from '../api/diagnosis-api.ts';
import { focusApi, type ActiveFocus, type FocusCatalogueEntry } from '../api/focus-api.ts';
import { createAppRouter } from '../router.tsx';

vi.mock('../analytics.ts', () => ({
  track: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});
const playerId = '00000000-0000-4000-8000-000000000001';

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
  actionItems: [],
  drilled: 0,
  groupKey: 'missed_capture',
  evidence: [],
  lineConsistency: null,
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
    weaknesses: [motifWeakness],
    narrative: null,
    ...overrides,
  };
}

const convertingWon: FocusCatalogueEntry = {
  id: '11111111-1111-4111-8111-111111111111',
  key: 'converting_won_positions',
  title: 'Converting won positions',
  description: 'Winning the games the position already says are won.',
  measureDescription: 'The share of won positions converted to wins.',
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
    measurements: [],
    practice: null,
    ...overrides,
  };
}

const gameId = '00000000-0000-4000-8000-0000000000b1';
const tournamentId = '00000000-0000-4000-8000-0000000000c1';

function renderDebrief(path: string) {
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

const listGamesEmpty = {
  games: [],
  total: 0,
  page: 1,
  limit: 100,
};

describe('DebriefRoute', () => {
  test('points a direct visit without a batch back at the import', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    renderDebrief('/debrief');
    expect(await screen.findByRole('heading', { name: 'No batch to debrief' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Go to import' })).toHaveAttribute('href', '/import');
  });

  test('ST-143: the debrief enters on the system, and its links hold the touch floor', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(diagnosisApi, 'getReport').mockResolvedValue(reportFixture());
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue(listGamesEmpty);
    vi.spyOn(focusApi, 'getFocus').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No focus.'),
    );
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([convertingWon]);

    renderDebrief(`/debrief?gameIds=${gameId}&tournamentId=${tournamentId}`);

    expect(await screen.findByRole('heading', { name: 'Tournament report' })).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Back to import' }).closest('.reveal-in'),
    ).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Skip the debrief' })).toHaveClass('min-h-11');
    for (const name of ['Your one focus', 'Your first drill']) {
      expect(screen.getByRole('heading', { level: 2, name }).closest('section')).toHaveClass(
        'reveal-in',
      );
    }
  });

  test('ST-143: the focus and drill states enter through the system with the floor held', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(diagnosisApi, 'getReport').mockResolvedValue(reportFixture());
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue(listGamesEmpty);
    vi.spyOn(focusApi, 'getFocus').mockResolvedValue(activeFocusFixture());

    renderDebrief(`/debrief?gameIds=${gameId}&tournamentId=${tournamentId}`);

    expect(await screen.findByText('working on')).toBeVisible();
    expect(screen.getByText('working on').closest('.reveal-in')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Work on it on the focus page' })).toHaveClass(
      'min-h-11',
    );
  });

  test('walks the three sections in order and deep-links the first drill', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(diagnosisApi, 'getReport').mockResolvedValue(reportFixture());
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue(listGamesEmpty);
    vi.spyOn(focusApi, 'getFocus').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No focus.'),
    );
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([convertingWon]);

    renderDebrief(`/debrief?gameIds=${gameId}&tournamentId=${tournamentId}`);

    // The order is the loop: what happened, the one focus, the first drill.
    // The H1 renders with the skeleton, so the drill link is what waits for
    // the report to land.
    expect(await screen.findByRole('link', { name: 'Practise the first drill' })).toHaveAttribute(
      'href',
      `/practice?kind=motif&group=missed_capture&label=Missed%20captures&stream=tournament`,
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tournament report' }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'Your one focus' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'Your first drill' })).toBeVisible();
  });

  test('honest lines when the report has not landed or has no drill', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'Not found.'),
    );
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue(listGamesEmpty);
    vi.spyOn(focusApi, 'getFocus').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No focus.'),
    );
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([]);

    renderDebrief(`/debrief?gameIds=${gameId}`);
    expect(
      await screen.findByText('Your first drill appears when the report lands.'),
    ).toBeVisible();
  });

  test('names the no-drill case when the report holds none', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(diagnosisApi, 'getReport').mockResolvedValue(reportFixture({ weaknesses: [] }));
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue(listGamesEmpty);
    vi.spyOn(focusApi, 'getFocus').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No focus.'),
    );
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([]);

    renderDebrief(`/debrief?gameIds=${gameId}`);
    expect(await screen.findByText('No weakness in this report has a drill yet.')).toBeVisible();
  });

  test('shows the working-on confirmation when a focus is already set', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(diagnosisApi, 'getReport').mockResolvedValue(reportFixture());
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue(listGamesEmpty);
    vi.spyOn(focusApi, 'getFocus').mockResolvedValue(activeFocusFixture());
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([convertingWon]);

    renderDebrief(`/debrief?gameIds=${gameId}`);
    expect(await screen.findByText('Converting won positions')).toBeVisible();
    expect(screen.queryByText('Choose a focus')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Work on it on the focus page' });
    expect(link.getAttribute('href')).toBe('/focus');
  });

  test('sets a catalogue focus from the debrief and shows it afterwards', async () => {
    const user = userEvent.setup();
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(diagnosisApi, 'getReport').mockResolvedValue(reportFixture());
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue(listGamesEmpty);
    vi.spyOn(focusApi, 'getFocus')
      .mockRejectedValueOnce(new ApiRequestError(404, 'not_found', undefined, 'No focus.'))
      .mockResolvedValue(activeFocusFixture());
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([convertingWon]);
    const setFocus = vi.spyOn(focusApi, 'setFocus').mockResolvedValue(activeFocusFixture());

    renderDebrief(`/debrief?gameIds=${gameId}`);
    await user.click(await screen.findByRole('button', { name: 'Set Converting won positions' }));
    expect(setFocus).toHaveBeenCalledWith({
      source: 'self',
      catalogueKey: 'converting_won_positions',
    });
    // The invalidation refetched the focus; the section reads as working on.
    expect(await screen.findByText('Work on it on the focus page')).toBeVisible();
  });

  test('renders the paid boundary when the focus refuses on upgrade_required', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(diagnosisApi, 'getReport').mockResolvedValue(reportFixture());
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue(listGamesEmpty);
    vi.spyOn(focusApi, 'getFocus').mockRejectedValue(
      new ApiRequestError(402, 'upgrade_required', undefined, 'Upgrade required.'),
    );
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([convertingWon]);

    renderDebrief(`/debrief?gameIds=${gameId}`);
    expect(
      await screen.findByRole('heading', { name: 'Your focus is part of the paid loop' }),
    ).toBeVisible();
    expect(screen.queryByText('Choose a focus')).not.toBeInTheDocument();
  });

  test('skip lands on the imported game review when the game id rides', async () => {
    const user = userEvent.setup();
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'Not found.'),
    );
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue(listGamesEmpty);
    vi.spyOn(focusApi, 'getFocus').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No focus.'),
    );
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([]);

    const { router } = renderDebrief(`/debrief?gameIds=${gameId}&gameId=${gameId}`);
    await user.click(await screen.findByText('Skip the debrief'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/games/${gameId}`);
    });
  });

  test('skip lands on the batch report when no game id rides', async () => {
    const user = userEvent.setup();
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'Not found.'),
    );
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue(listGamesEmpty);
    vi.spyOn(focusApi, 'getFocus').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No focus.'),
    );
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([]);

    const { router } = renderDebrief(`/debrief?gameIds=${gameId}&tournamentId=${tournamentId}`);
    await user.click(await screen.findByText('Skip the debrief'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/report');
      expect(router.state.location.search).toEqual({
        stream: 'tournament',
        gameIds: [gameId],
        tournamentId,
      });
    });
  });
  test('shows a fallback when the focus itself fails to load', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'Not found.'),
    );
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue(listGamesEmpty);
    vi.spyOn(focusApi, 'getFocus').mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Server error.'),
    );
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([]);

    renderDebrief(`/debrief?gameIds=${gameId}`);
    expect(
      await screen.findByRole('heading', { name: 'Your focus could not be loaded' }),
    ).toBeVisible();
    expect(screen.queryByText('Choose a focus')).not.toBeInTheDocument();
  });

  test('says the catalogue could not be loaded when only the catalogue fails', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'Not found.'),
    );
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue(listGamesEmpty);
    vi.spyOn(focusApi, 'getFocus').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No focus.'),
    );
    vi.spyOn(focusApi, 'listFocuses').mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Server error.'),
    );

    renderDebrief(`/debrief?gameIds=${gameId}`);
    expect(
      await screen.findByText('The focus catalogue could not be loaded right now. Try again.'),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Set Converting won positions' }),
    ).not.toBeInTheDocument();
  });

  test('sets a paired coach-instruction focus from the debrief', async () => {
    const user = userEvent.setup();
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(diagnosisApi, 'getReport').mockResolvedValue(reportFixture());
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue(listGamesEmpty);
    vi.spyOn(focusApi, 'getFocus').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No focus.'),
    );
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([convertingWon]);
    const setFocus = vi.spyOn(focusApi, 'setFocus').mockResolvedValue(activeFocusFixture());

    renderDebrief(`/debrief?gameIds=${gameId}`);
    await user.type(
      await screen.findByLabelText('Coach instruction'),
      '  Play through the endgame slowly.  ',
    );
    await user.selectOptions(
      screen.getByLabelText('Paired measurable focus'),
      'converting_won_positions',
    );
    await user.click(screen.getByRole('button', { name: 'Set coach focus' }));

    await waitFor(() => {
      expect(setFocus).toHaveBeenCalledWith({
        source: 'coach',
        coachInstruction: 'Play through the endgame slowly.',
        pairedCatalogueKey: 'converting_won_positions',
      });
    });
  });

  test('refuses an empty coach instruction locally without calling the API', async () => {
    const user = userEvent.setup();
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'Not found.'),
    );
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue(listGamesEmpty);
    vi.spyOn(focusApi, 'getFocus').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No focus.'),
    );
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([convertingWon]);
    const setFocus = vi.spyOn(focusApi, 'setFocus');

    renderDebrief(`/debrief?gameIds=${gameId}`);
    await user.click(await screen.findByRole('button', { name: 'Set coach focus' }));
    expect(
      await screen.findByText('Write the instruction in the coach’s own words.'),
    ).toBeVisible();
    expect(
      screen.getAllByText(
        'Choose a measurable focus to pair with, so we can still show whether the work is helping.',
      ).length,
    ).toBeGreaterThan(0);
    expect(setFocus).not.toHaveBeenCalled();
  });

  test('shows the API refusal when setting a focus is rejected', async () => {
    const user = userEvent.setup();
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'Not found.'),
    );
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue(listGamesEmpty);
    vi.spyOn(focusApi, 'getFocus').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No focus.'),
    );
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([convertingWon]);
    vi.spyOn(focusApi, 'setFocus').mockRejectedValue(
      new ApiRequestError(403, 'forbidden', undefined, 'No.'),
    );

    renderDebrief(`/debrief?gameIds=${gameId}`);
    await user.click(await screen.findByRole('button', { name: 'Set Converting won positions' }));

    expect(await screen.findByText('This focus cannot be set for this player.')).toBeVisible();
  });
});

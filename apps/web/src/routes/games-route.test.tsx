import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { accountApi, ApiRequestError, type Me } from '../api/account-api.ts';
import { diagnosisApi, type GameSummary } from '../api/diagnosis-api.ts';
import { createAppRouter } from '../router.tsx';
const meFixture: Me = {
  userId: 'user-1',
  email: 'player@example.com',
  name: 'Player',
  tier: 'beginner',
  player: {
    id: '00000000-0000-4000-8000-000000000001',
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
    stream: 'tournament',
    source: 'pgn_upload',
    playerColor: 'white',
    result: '1-0',
    playedAt: '2026-08-14T00:00:00.000Z',
    event: 'Club Championship',
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
    analysisStatus: 'complete',
    analyzedAt: null,
    ...overrides,
  };
}

function renderRoute(path = '/games?stream=tournament') {
  const history = createMemoryHistory({ initialEntries: [path] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('GamesRoute', () => {
  beforeEach(() => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('renders each game card through Heading/Text, not raw markup', async () => {
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [gameFixture()],
      total: 1,
      page: 1,
      limit: 100,
    });

    renderRoute();

    expect(await screen.findByText('Mina vs Opponent')).toBeVisible();
    expect(screen.getByText(/Club Championship/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      `/games/${gameFixture().id}`,
    );
  });

  test('shows an analysis-in-progress note for an unanalysed game', async () => {
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [gameFixture({ analysisStatus: 'pending' })],
      total: 1,
      page: 1,
      limit: 100,
    });

    renderRoute();

    expect(await screen.findByText('Analysis in progress.')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Review' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View game' })).toHaveAttribute(
      'href',
      `/games/${gameFixture().id}`,
    );
  });

  test('shows an EmptyState when there are no games in this stream', async () => {
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [],
      total: 0,
      page: 1,
      limit: 100,
    });

    renderRoute();

    expect(await screen.findByRole('heading', { name: 'No tournament games yet' })).toBeVisible();
    expect(screen.getByText('Import games to see them reviewed.')).toBeVisible();
  });

  test('shows an EmptyState when the games list fails to load', async () => {
    vi.spyOn(diagnosisApi, 'listGames').mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Server error.'),
    );

    renderRoute();

    expect(
      await screen.findByRole('heading', { name: 'Your games could not be loaded' }),
    ).toBeVisible();
    expect(screen.getByText('Try again in a moment.')).toBeVisible();
  });

  test('shows the loading placeholder while games are pending', async () => {
    vi.spyOn(diagnosisApi, 'listGames').mockReturnValue(new Promise(() => {}));

    renderRoute();

    expect(await screen.findByRole('status', { name: 'Loading games' })).toBeVisible();
  });

  test('shows a failed-analysis label with a Retry action, not silence', async () => {
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [gameFixture({ analysisStatus: 'failed' })],
      total: 1,
      page: 1,
      limit: 100,
    });

    renderRoute();

    expect(await screen.findByText('Analysis failed.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Review' })).not.toBeInTheDocument();
  });

  test('Retry re-queues analysis for a failed game', async () => {
    const user = userEvent.setup();
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [gameFixture({ analysisStatus: 'failed' })],
      total: 1,
      page: 1,
      limit: 100,
    });
    const queueAnalysis = vi.spyOn(diagnosisApi, 'queueAnalysis').mockResolvedValue(undefined);

    renderRoute();

    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(queueAnalysis).toHaveBeenCalledWith(gameFixture().id));
  });

  test('deleting a game from its card removes it after confirmation', async () => {
    const user = userEvent.setup();
    const game = gameFixture();
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [game],
      total: 1,
      page: 1,
      limit: 100,
    });
    const deleteGame = vi.spyOn(diagnosisApi, 'deleteGame').mockResolvedValue(undefined);

    renderRoute();

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this game?' });
    expect(dialog).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteGame).toHaveBeenCalledWith(game.id));
  });

  test('cancelling the delete dialog does not call deleteGame', async () => {
    const user = userEvent.setup();
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [gameFixture()],
      total: 1,
      page: 1,
      limit: 100,
    });
    const deleteGame = vi.spyOn(diagnosisApi, 'deleteGame').mockResolvedValue(undefined);

    renderRoute();

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(deleteGame).not.toHaveBeenCalled();
  });
});

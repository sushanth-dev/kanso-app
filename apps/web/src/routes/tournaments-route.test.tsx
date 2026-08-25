import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { accountApi, ApiRequestError, type Me } from '../api/account-api.ts';
import { tournamentApi } from '../api/tournament-api.ts';
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

function renderAt(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('TournamentsRoute', () => {
  beforeEach(() => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('lists each tournament with its counts and an open link', async () => {
    vi.spyOn(tournamentApi, 'listTournaments').mockResolvedValue({
      tournaments: [
        {
          id: '00000000-0000-4000-8000-0000000000aa',
          name: 'Delhi Open',
          site: 'Delhi',
          startedAt: '2026-08-01T00:00:00.000Z',
          endedAt: '2026-08-05T00:00:00.000Z',
          gameCount: 7,
          analysedCount: 7,
        },
      ],
    });

    renderAt('/tournaments');

    expect(await screen.findByText('Delhi Open')).toBeVisible();
    expect(screen.getByText('Delhi')).toBeVisible();
    expect(screen.getByText('7 games')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open tournament' })).toHaveAttribute(
      'href',
      '/tournaments/00000000-0000-4000-8000-0000000000aa',
    );
  });

  test('shows an EmptyState when there are no tournaments', async () => {
    vi.spyOn(tournamentApi, 'listTournaments').mockResolvedValue({ tournaments: [] });

    renderAt('/tournaments');

    expect(await screen.findByRole('heading', { name: 'No tournaments yet' })).toBeVisible();
  });

  test('shows an EmptyState when the list fails to load', async () => {
    vi.spyOn(tournamentApi, 'listTournaments').mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Server error.'),
    );

    renderAt('/tournaments');

    expect(
      await screen.findByRole('heading', { name: 'Your tournaments could not be loaded' }),
    ).toBeVisible();
  });
});

describe('TournamentDetailRoute', () => {
  beforeEach(() => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const tournamentId = '00000000-0000-4000-8000-0000000000aa';

  test('renders the tournament with its games in round order and round-decay', async () => {
    vi.spyOn(tournamentApi, 'getTournament').mockResolvedValue({
      id: tournamentId,
      name: 'Delhi Open',
      site: 'Delhi',
      startedAt: '2026-08-01T00:00:00.000Z',
      endedAt: '2026-08-05T00:00:00.000Z',
      score: 5,
      scoreGames: 7,
      scoreExcluded: 0,
      games: [
        {
          id: '00000000-0000-4000-8000-0000000000bb',
          round: 1,
          board: 3,
          opponent: 'Opponent A',
          playerColor: 'white',
          result: 'win',
          analysed: true,
        },
      ],
    });
    vi.spyOn(tournamentApi, 'getRoundDecay').mockResolvedValue({
      tournamentId,
      roundCount: 1,
      rounds: [{ round: 1, games: 3, mistakes: 4, lossPerMove: 12.5 }],
    });

    renderAt(`/tournaments/${tournamentId}`);

    expect(await screen.findByRole('heading', { name: 'Delhi Open' })).toBeVisible();
    expect(screen.getByText('Opponent A')).toBeVisible();
    expect(screen.getByText('W')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      '/games/00000000-0000-4000-8000-0000000000bb',
    );
    expect(screen.getByText('Round-by-round decay')).toBeVisible();
    expect(screen.getByText('12.5 cp/move')).toBeVisible();
  });

  test('shows the forbidden state for another player’s tournament', async () => {
    vi.spyOn(tournamentApi, 'getTournament').mockRejectedValue(
      new ApiRequestError(403, 'forbidden', undefined, 'Not your tournament.'),
    );

    renderAt(`/tournaments/${tournamentId}`);

    expect(
      await screen.findByRole('heading', { name: 'This tournament is not yours' }),
    ).toBeVisible();
  });
});

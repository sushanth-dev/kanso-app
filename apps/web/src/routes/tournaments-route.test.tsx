import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { accountApi, ApiRequestError, type Me } from '../api/account-api.ts';
import {
  tournamentApi,
  type TournamentDetail,
  type TournamentList,
} from '../api/tournament-api.ts';
import { TournamentCard } from './tournaments-route.tsx';
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

  test('shows a single-day event as one date and a partial analysis count as neutral', async () => {
    vi.spyOn(tournamentApi, 'listTournaments').mockResolvedValue({
      tournaments: [
        {
          id: '00000000-0000-4000-8000-0000000000ad',
          name: 'Club Rapid',
          site: null,
          startedAt: '2026-08-01T00:00:00.000Z',
          endedAt: '2026-08-01T00:00:00.000Z',
          gameCount: 7,
          analysedCount: 3,
        },
      ],
    });

    renderAt('/tournaments');

    expect(await screen.findByText('Club Rapid')).toBeVisible();
    expect(screen.getByText('Aug 1, 2026')).toBeVisible();
    expect(screen.queryByText('Delhi')).not.toBeInTheDocument();
    expect(screen.getByText('3 of 7 analysed')).toBeVisible();
    expect(screen.getByText('7 games')).toBeVisible();
  });

  test('greys out a card and stops its action while the tournament is under the report floor', () => {
    render(
      <TournamentCard
        summary={{
          id: '00000000-0000-4000-8000-0000000000ae',
          name: 'Under floor',
          site: null,
          startedAt: null,
          endedAt: null,
          gameCount: 4,
          analysedCount: 2,
        }}
        disabledReason="Finish analysing the batch before opening the report."
      />,
    );

    expect(screen.getByText('Under floor')).toBeVisible();
    expect(screen.queryByText(/Aug|2026/)).not.toBeInTheDocument();
    const action = screen.getByRole('button', { name: 'Open tournament' });
    expect(action).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Open tournament' })).not.toBeInTheDocument();
    expect(screen.getByText('Finish analysing the batch before opening the report.')).toBeVisible();
    expect(screen.getByText('2 of 4 analysed')).toBeVisible();
  });

  test('shows a loading status while the list is fetched', async () => {
    const { promise } = Promise.withResolvers<TournamentList>();
    vi.spyOn(tournamentApi, 'listTournaments').mockReturnValue(promise);

    renderAt('/tournaments');

    expect(await screen.findByRole('status', { name: 'Loading tournaments' })).toBeVisible();
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
  test('shows the generic empty state for a server error, never the forbidden copy', async () => {
    vi.spyOn(tournamentApi, 'getTournament').mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Server error.'),
    );

    renderAt(`/tournaments/${tournamentId}`);

    expect(
      await screen.findByRole('heading', { name: 'This tournament could not be loaded' }),
    ).toBeVisible();
    expect(screen.getByText('Go back and try again.')).toBeVisible();
    expect(screen.queryByText('This tournament is not yours')).not.toBeInTheDocument();
  });

  test('shows a loading skeleton while the tournament is fetched', async () => {
    const { promise } = Promise.withResolvers<TournamentDetail>();
    vi.spyOn(tournamentApi, 'getTournament').mockReturnValue(promise);

    renderAt(`/tournaments/${tournamentId}`);

    expect(await screen.findByRole('status', { name: 'Loading tournament' })).toBeVisible();
  });

  test('renders a tournament without a site, a date range, or excluded games plainly', async () => {
    vi.spyOn(tournamentApi, 'getTournament').mockResolvedValue({
      id: tournamentId,
      name: 'Bare event',
      site: null,
      startedAt: null,
      endedAt: null,
      score: 3,
      scoreGames: 9,
      scoreExcluded: 0,
      games: [],
    });
    vi.spyOn(tournamentApi, 'getRoundDecay').mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Server error.'),
    );

    renderAt(`/tournaments/${tournamentId}`);

    expect(await screen.findByRole('heading', { name: 'Bare event' })).toBeVisible();
    expect(screen.getByText('3 / 9')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'No games in this tournament' })).toBeVisible();
    expect(screen.getByText('Import tournament games to see them here.')).toBeVisible();
    expect(screen.queryByText('games not counted')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Round-by-round decay' })).not.toBeInTheDocument();
  });

  test('collapses a same-day range to one date and lists excluded games', async () => {
    vi.spyOn(tournamentApi, 'getTournament').mockResolvedValue({
      id: tournamentId,
      name: 'One-day open',
      site: 'Dhaka',
      startedAt: '2026-08-01T00:00:00.000Z',
      endedAt: '2026-08-01T00:00:00.000Z',
      score: 2,
      scoreGames: 6,
      scoreExcluded: 2,
      games: [],
    });
    vi.spyOn(tournamentApi, 'getRoundDecay').mockResolvedValue({
      tournamentId,
      roundCount: 0,
      rounds: [],
    });

    renderAt(`/tournaments/${tournamentId}`);

    expect(await screen.findByText('Aug 1, 2026')).toBeVisible();
    expect(screen.getByText('2 games not counted')).toBeVisible();
    expect(
      await screen.findByText('Not enough analysed games to report a trend yet.'),
    ).toBeVisible();
  });

  test('fills unknown round, board, opponent, and result with honest placeholders', async () => {
    vi.spyOn(tournamentApi, 'getTournament').mockResolvedValue({
      id: tournamentId,
      name: 'Sparse games',
      site: null,
      startedAt: '2026-08-01T00:00:00.000Z',
      endedAt: null,
      score: 0,
      scoreGames: 1,
      scoreExcluded: 0,
      games: [
        {
          id: '00000000-0000-4000-8000-0000000000bf',
          round: null,
          board: null,
          opponent: null,
          playerColor: 'white',
          result: null,
          analysed: false,
        },
      ],
    });
    vi.spyOn(tournamentApi, 'getRoundDecay').mockResolvedValue({
      tournamentId,
      roundCount: 1,
      rounds: [{ round: 1, games: 1, mistakes: 2, lossPerMove: null }],
    });

    renderAt(`/tournaments/${tournamentId}`);

    expect(await screen.findByText('Aug 1, 2026')).toBeVisible();
    // Round, board, and result are each an em dash; the decay row's null
    // loss reads "— cp/move" inside a longer text node.
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.getByText('Aug 1, 2026')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      '/games/00000000-0000-4000-8000-0000000000bf',
    );
    expect(screen.getByText('1 game')).toBeVisible();
  });
});

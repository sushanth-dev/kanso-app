import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { accountApi, ApiRequestError, type Me } from '../api/account-api.ts';
import {
  tournamentApi,
  type RoundDecay,
  type TournamentDecay,
  type TournamentDetail,
  type TournamentGame,
} from '../api/tournament-api.ts';
import { createAppRouter } from '../router.tsx';

vi.mock('../analytics.ts', () => ({
  track: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

const playerId = '00000000-0000-4000-8000-000000000001';
const tournamentId = '00000000-0000-4000-8000-0000000000c1';
const gameId = '00000000-0000-4000-8000-0000000000b1';

const meFixture: Me = {
  userId: 'user-1',
  email: 'player@example.com',
  name: 'Player',
  tier: 'beginner',
  analyticsSuiteAllowed: false,
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

function gameFixture(overrides: Partial<TournamentGame> = {}): TournamentGame {
  return {
    id: gameId,
    round: 1,
    board: 3,
    opponent: 'Magness C',
    playerColor: 'white',
    result: 'win',
    analysed: true,
    ...overrides,
  };
}

function detailFixture(overrides: Partial<TournamentDetail> = {}): TournamentDetail {
  return {
    id: tournamentId,
    name: 'City Open',
    site: 'Columbus Chess Club',
    // Noon UTC reads as the same calendar day from any reasonable timezone.
    startedAt: '2026-09-01T12:00:00.000Z',
    endedAt: '2026-09-01T12:00:00.000Z',
    games: [gameFixture()],
    score: 2.5,
    scoreGames: 5,
    scoreExcluded: 0,
    ...overrides,
  };
}

function decayFixture(overrides: Partial<TournamentDecay> = {}): TournamentDecay {
  const rounds: RoundDecay[] = [
    { round: 1, games: 2, mistakes: 1, lossPerMove: 12.5 },
    { round: 2, games: 1, mistakes: 0, lossPerMove: null },
  ];
  return { tournamentId, rounds, roundCount: rounds.length, ...overrides };
}

function renderTournament(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router, queryClient };
}

describe('TournamentDetailRoute', () => {
  test('shows the loading skeleton while the tournament is fetched', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(tournamentApi, 'getTournament').mockReturnValue(new Promise(() => {}));
    vi.spyOn(tournamentApi, 'getRoundDecay').mockReturnValue(new Promise(() => {}));

    renderTournament(`/tournaments/${tournamentId}`);
    expect(await screen.findByRole('status', { name: 'Loading tournament' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'City Open' })).not.toBeInTheDocument();
  });

  test('renders the tournament header: name, site, same-day date, score', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(tournamentApi, 'getTournament').mockResolvedValue(detailFixture());
    vi.spyOn(tournamentApi, 'getRoundDecay').mockResolvedValue(decayFixture());

    renderTournament(`/tournaments/${tournamentId}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'City Open' })).toBeVisible();
    expect(screen.getByText('Columbus Chess Club')).toBeInTheDocument();
    expect(screen.getByText('Sep 1, 2026')).toBeInTheDocument();
    expect(screen.getByText('2.5 / 5')).toBeInTheDocument();
    expect(screen.queryByText(/not counted/)).not.toBeInTheDocument();
  });

  test('ST-145: the detail page enters on the system and the review buttons hold the touch floor', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(tournamentApi, 'getTournament').mockResolvedValue(detailFixture());
    vi.spyOn(tournamentApi, 'getRoundDecay').mockResolvedValue(decayFixture());

    renderTournament(`/tournaments/${tournamentId}`);

    const header = await screen.findByRole('heading', { level: 1, name: 'City Open' });
    expect(header.closest('header')).toHaveClass('reveal-in');
    expect(screen.getByRole('link', { name: 'Back to tournaments' })).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'Review' })[0]).toHaveClass('min-h-11');
    expect(screen.getAllByRole('list').some((el) => el.classList.contains('reveal-in'))).toBe(true);
  });

  test('a multi-day event reads as a range; no dates reads as no range', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(tournamentApi, 'getTournament').mockResolvedValue(
      detailFixture({
        startedAt: '2026-09-01T12:00:00.000Z',
        endedAt: '2026-09-03T12:00:00.000Z',
      }),
    );
    vi.spyOn(tournamentApi, 'getRoundDecay').mockResolvedValue(decayFixture());

    const { unmount } = renderTournament(`/tournaments/${tournamentId}`);
    expect(await screen.findByText('Sep 1, 2026 – Sep 3, 2026')).toBeVisible();
    unmount();

    vi.spyOn(tournamentApi, 'getTournament').mockResolvedValue(
      detailFixture({ startedAt: null, endedAt: null }),
    );
    renderTournament(`/tournaments/${tournamentId}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'City Open' })).toBeVisible();
    expect(screen.queryByText(/Sep/)).not.toBeInTheDocument();
  });

  test('excluded games get their own badge, counted in the score line', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(tournamentApi, 'getTournament').mockResolvedValue(detailFixture({ scoreExcluded: 1 }));
    vi.spyOn(tournamentApi, 'getRoundDecay').mockResolvedValue(decayFixture());

    renderTournament(`/tournaments/${tournamentId}`);
    expect(await screen.findByText('1 games not counted')).toBeVisible();
  });

  test('lists each game with round, board, opponent, result, and a review link', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(tournamentApi, 'getTournament').mockResolvedValue(
      detailFixture({
        games: [
          gameFixture(),
          gameFixture({
            id: '00000000-0000-4000-8000-0000000000b2',
            round: 2,
            board: null,
            opponent: null,
            playerColor: 'black',
            result: 'loss',
          }),
          gameFixture({
            id: '00000000-0000-4000-8000-0000000000b3',
            round: null,
            board: 8,
            opponent: 'Rook Lynch',
            playerColor: 'black',
            result: null,
          }),
        ],
      }),
    );
    vi.spyOn(tournamentApi, 'getRoundDecay').mockResolvedValue(decayFixture());

    renderTournament(`/tournaments/${tournamentId}`);
    expect(await screen.findByText('Magness C')).toBeVisible();
    expect(screen.getByText('Rook Lynch')).toBeInTheDocument();
    expect(screen.getByText('Unknown opponent')).toBeInTheDocument();
    // Results read as W/D/L glyphs; a game with no recorded result reads as a dash.
    expect(screen.getByText('W')).toBeInTheDocument();
    expect(screen.getByText('L')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(3); // no board, no result, no round
    expect(screen.getAllByRole('link', { name: 'Review' })).toHaveLength(3);
  });

  test('a tournament with no games says so plainly', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(tournamentApi, 'getTournament').mockResolvedValue(detailFixture({ games: [] }));
    vi.spyOn(tournamentApi, 'getRoundDecay').mockResolvedValue(decayFixture());

    renderTournament(`/tournaments/${tournamentId}`);
    expect(await screen.findByText('No games in this tournament')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Review' })).not.toBeInTheDocument();
  });

  test("someone else's tournament is refused; other failures are not", async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(tournamentApi, 'getTournament').mockRejectedValue(
      new ApiRequestError(403, 'forbidden', undefined, 'Not yours.'),
    );
    vi.spyOn(tournamentApi, 'getRoundDecay').mockRejectedValue(
      new ApiRequestError(403, 'forbidden', undefined, 'Not yours.'),
    );

    const { unmount } = renderTournament(`/tournaments/${tournamentId}`);
    expect(await screen.findByText('This tournament is not yours')).toBeVisible();
    unmount();

    vi.spyOn(tournamentApi, 'getTournament').mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Boom.'),
    );
    renderTournament(`/tournaments/${tournamentId}`);
    expect(await screen.findByText('This tournament could not be loaded')).toBeVisible();
  });

  test('the round decay names the per-round loss and the games behind it', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(tournamentApi, 'getTournament').mockResolvedValue(detailFixture());
    vi.spyOn(tournamentApi, 'getRoundDecay').mockResolvedValue(decayFixture());

    renderTournament(`/tournaments/${tournamentId}`);
    expect(await screen.findByText('Round-by-round decay')).toBeVisible();
    expect(screen.getByText('Round 1')).toBeInTheDocument();
    expect(screen.getByText('12.5 cp/move')).toBeInTheDocument();
    expect(screen.getByText('2 games')).toBeInTheDocument();
    expect(screen.getByText('Round 2')).toBeInTheDocument();
    expect(screen.getByText('— cp/move')).toBeInTheDocument();
    expect(screen.getByText('1 game')).toBeInTheDocument();
  });

  test('a decay with no reportable rounds says so honestly', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(tournamentApi, 'getTournament').mockResolvedValue(detailFixture());
    vi.spyOn(tournamentApi, 'getRoundDecay').mockResolvedValue(
      decayFixture({ rounds: [], roundCount: 0 }),
    );

    renderTournament(`/tournaments/${tournamentId}`);
    expect(await screen.findByText('Round-by-round decay')).toBeVisible();
    expect(
      screen.getByText('Not enough analysed games to report a trend yet.'),
    ).toBeInTheDocument();
  });

  test('a failed decay is no card, not an error page', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(tournamentApi, 'getTournament').mockResolvedValue(detailFixture());
    vi.spyOn(tournamentApi, 'getRoundDecay').mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Boom.'),
    );

    renderTournament(`/tournaments/${tournamentId}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'City Open' })).toBeVisible();
    expect(screen.queryByText('Round-by-round decay')).not.toBeInTheDocument();
  });
});

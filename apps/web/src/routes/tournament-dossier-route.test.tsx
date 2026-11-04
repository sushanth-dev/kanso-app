import { describe, expect, test, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { accountApi, type Me } from '../api/account-api.ts';
import {
  tournamentApi,
  type TournamentDetail,
  type TournamentGame,
} from '../api/tournament-api.ts';
import { diagnosisApi, type Report } from '../api/diagnosis-api.ts';
import { createAppRouter } from '../router.tsx';
import { TournamentDossierScreen } from './tournament-dossier-route.tsx';

afterEach(() => {
  vi.restoreAllMocks();
});

const playerId = '00000000-0000-4000-8000-000000000001';
const tournamentId = '00000000-0000-4000-8000-0000000000c1';

const meFixture: Me = {
  userId: 'user-1',
  email: 'player@example.com',
  name: 'Maya',
  tier: 'beginner',
  analyticsSuiteAllowed: false,
  player: {
    id: playerId,
    displayName: 'Maya Patel',
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
    id: '00000000-0000-4000-8000-0000000000b1',
    round: 1,
    board: 3,
    opponent: 'Alex G',
    playerColor: 'white',
    result: 'win',
    analysed: true,
    ...overrides,
  };
}

function detailFixture(overrides: Partial<TournamentDetail> = {}): TournamentDetail {
  return {
    id: tournamentId,
    name: 'National Junior Open 2026',
    site: 'Chicago, IL',
    startedAt: '2026-10-15T12:00:00.000Z',
    endedAt: '2026-10-17T18:00:00.000Z',
    games: [
      gameFixture({ round: 1, board: 3, opponent: 'Alex G', result: 'win' }),
      gameFixture({ round: 2, board: 1, opponent: 'Rohan M', result: 'loss' }),
    ],
    score: 1,
    scoreGames: 2,
    scoreExcluded: 0,
    ...overrides,
  };
}

describe('TournamentDossierScreen', () => {
  test('renders student header, results table, decay, and coach notes box', () => {
    const detail = detailFixture();
    const decay = [
      { round: 1, games: 1, mistakes: 2, lossPerMove: 24.5 },
      { round: 2, games: 1, mistakes: 4, lossPerMove: 48.2 },
    ];
    const weaknesses = [{ motif: 'Fork', cost: 1, count: 2 }];

    const { container } = render(
      <TournamentDossierScreen
        detail={detail}
        decay={decay}
        playerName="Maya Patel"
        weaknesses={weaknesses}
      />,
    );

    // Header information
    expect(
      screen.getByRole('heading', { level: 1, name: 'National Junior Open 2026' }),
    ).toBeVisible();
    expect(screen.getByText('Maya Patel')).toBeVisible();
    expect(screen.getByText('Site: Chicago, IL')).toBeVisible();
    expect(screen.getByText('Score: 1 / 2')).toBeVisible();

    // Games table
    expect(screen.getByText('Alex G')).toBeVisible();
    expect(screen.getByText('1 - 0 (Win)')).toBeVisible();
    expect(screen.getByText('Rohan M')).toBeVisible();
    expect(screen.getByText('0 - 1 (Loss)')).toBeVisible();

    // Decay cards
    expect(screen.getByText('Performance & Fatigue Decay')).toBeVisible();
    expect(screen.getByText('25 cp')).toBeVisible();
    expect(screen.getByText('48 cp')).toBeVisible();

    // Weakness breakdown
    expect(screen.getByText('Key Tactical Motifs & Leak Breakdown')).toBeVisible();
    expect(screen.getByText('Fork')).toBeVisible();

    // Tactical mistake boards
    expect(screen.getByText('Key Tactical Positions from Games')).toBeVisible();

    // Coach notes box
    expect(
      screen.getByRole('heading', { level: 3, name: 'Coach Debrief & Action Plan' }),
    ).toBeVisible();
    expect(container.querySelectorAll('.coach-notes-line')).toHaveLength(4);
  });

  test('clicking print button calls window.print', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    const detail = detailFixture();

    render(
      <TournamentDossierScreen
        detail={detail}
        decay={[]}
        playerName="Maya Patel"
        weaknesses={[]}
      />,
    );

    const printButton = screen.getByRole('button', { name: 'Print dossier' });
    fireEvent.click(printButton);

    expect(printSpy).toHaveBeenCalledTimes(1);
    printSpy.mockRestore();
  });
});

describe('TournamentDossierRoute', () => {
  test('loads route data and renders dossier via router', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(tournamentApi, 'getTournament').mockResolvedValue(detailFixture());
    vi.spyOn(tournamentApi, 'getRoundDecay').mockResolvedValue({
      tournamentId,
      rounds: [{ round: 1, games: 1, mistakes: 1, lossPerMove: 30 }],
      roundCount: 1,
    });
    vi.spyOn(diagnosisApi, 'getReport').mockResolvedValue({
      id: '00000000-0000-4000-8000-0000000000r1',
      playerId,
      stream: 'tournament',
      tournamentId,
      generatedAt: '2026-10-18T00:00:00.000Z',
      gamesCovered: 2,
      windowStart: null,
      windowEnd: null,
      timeTroubleFromMove: null,
      timeTroubleReason: null,
      weaknesses: [
        {
          kind: 'motif',
          group: 'pin',
          label: 'Pin',
          occurrences: 2,
          ratingLeak: 15,
          relativeFrequency: 0.2,
          confidence: 'high',
        },
      ],
      missedPunishment: null,
      phaseHeatmap: [],
      drillSuggestions: [],
      narrative: null,
    } as unknown as Report);

    const history = createMemoryHistory({
      initialEntries: [`/tournaments/${tournamentId}/dossier`],
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const router = createAppRouter({ history, queryClient });

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'National Junior Open 2026' }),
    ).toBeVisible();
    expect(screen.getByText('Maya Patel')).toBeVisible();
    expect(screen.getByText('Pin')).toBeVisible();
  });
});

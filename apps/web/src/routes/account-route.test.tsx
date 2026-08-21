import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError, type Me, type Player } from '../api/account-api.ts';
import { diagnosisApi } from '../api/diagnosis-api.ts';
import { createAppRouter } from '../router.tsx';
import { AccountScreen, PlayerCard, type PlayerDiagnosisState } from './account-route.tsx';
vi.mock('../auth-client.ts', () => ({
  authClient: { changePassword: vi.fn() },
}));

const playerId = '00000000-0000-4000-8000-000000000001';

function player(overrides: Partial<Player> = {}): Player {
  return {
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
    createdAt: '2026-08-14T00:00:00.000Z',
    ...overrides,
  };
}

function meFixture(overrides: Partial<Me> = {}): Me {
  return {
    userId: 'user-1',
    email: 'player@example.com',
    name: 'Player',
    tier: 'free',
    player: player(),
    ...overrides,
  };
}

function renderAccount(me: Me = meFixture(), signOut = vi.fn().mockResolvedValue(undefined)) {
  const history = createMemoryHistory();
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <AccountScreen me={me} signOut={signOut} />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
}

function renderPlayerCard(state: PlayerDiagnosisState) {
  const history = createMemoryHistory();
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <PlayerCard player={player()} state={state} />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
}

describe('AccountScreen', () => {
  beforeEach(() => {
    vi.spyOn(diagnosisApi, 'getReport').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'Not found.'),
    );
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [],
      total: 0,
      page: 1,
      limit: 100,
    });
  });

  test('renders account identity and the owned players', () => {
    renderAccount();
    expect(screen.getByRole('heading', { name: 'Your account' })).toBeVisible();
    expect(screen.getByText('Mina')).toBeVisible();
    expect(screen.getByText('player@example.com')).toBeVisible();
    expect(screen.getByText('Free')).toBeVisible();
  });
  test('renders the change-password section', () => {
    renderAccount();
    expect(screen.getByRole('heading', { name: 'Change password' })).toBeVisible();
  });

  test('signs out through the injected handler', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn().mockResolvedValue(undefined);
    renderAccount(meFixture(), signOut);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(signOut).toHaveBeenCalledOnce();
  });

  test('keeps the account visible and reports a sign-out failure', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn().mockRejectedValue(new Error('HTTP failure'));
    renderAccount(meFixture(), signOut);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByText('Sign out failed.', { exact: true })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Your account' })).toBeVisible();
  });
  test('owned cards link to edit', () => {
    renderAccount();
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/account/player');
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveClass('min-w-11', 'justify-center');
  });
});

describe('PlayerCard diagnosis states', () => {
  test('shows the top weakness and games covered', () => {
    renderPlayerCard({
      kind: 'diagnosis',
      topWeakness: 'Hanging pieces in the middlegame',
      gamesCovered: 12,
    });
    expect(screen.getByText(/Top weakness:/)).toBeVisible();
    expect(screen.getByText('Hanging pieces in the middlegame')).toBeVisible();
    expect(screen.getByText('12 tournament games')).toBeVisible();
  });

  test('shows the honest-empty message', () => {
    renderPlayerCard({ kind: 'honest-empty' });
    expect(screen.getByText('Could not identify a defensible weakness yet.')).toBeVisible();
  });

  test('shows the still-analyzing message', () => {
    renderPlayerCard({ kind: 'still-analyzing' });
    expect(
      screen.getByText('Analysis in progress. Come back in a couple of minutes.'),
    ).toBeVisible();
  });

  test('shows the no-diagnosis message', () => {
    renderPlayerCard({ kind: 'no-diagnosis' });
    expect(
      screen.getByText('No diagnosis yet. Import games to get a ranked report.'),
    ).toBeVisible();
  });

  test('shows the unavailable message', () => {
    renderPlayerCard({ kind: 'unavailable' });
    expect(screen.getByText('Diagnosis unavailable right now.')).toBeVisible();
  });

  test('shows the pending skeleton', () => {
    renderPlayerCard({ kind: 'pending' });
    expect(screen.getByRole('status', { name: 'Loading diagnosis' })).toBeVisible();
  });
});

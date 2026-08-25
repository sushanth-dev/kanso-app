import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router';
import { describe, expect, test, vi } from 'vitest';
import type { Me, Player } from '../api/account-api.ts';
import { createAppRouter } from '../router.tsx';
import { SettingsScreen } from './settings-route.tsx';

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
    currentStreak: 0,
    xp: 0,
    level: 1,
    createdAt: '2026-08-14T00:00:00.000Z',
    ...overrides,
  };
}

function meFixture(overrides: Partial<Me> = {}): Me {
  return {
    userId: 'user-1',
    email: 'player@example.com',
    name: 'Player',
    tier: 'beginner',
    player: player(),
    ...overrides,
  };
}

function renderSettings(
  me: Me = meFixture(),
  signOut: () => Promise<void> = vi.fn().mockResolvedValue(undefined),
) {
  const history = createMemoryHistory();
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <SettingsScreen me={me} signOut={signOut} />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
}

describe('SettingsScreen', () => {
  test('renders one page: identity, streak, and settings sections under one H1', () => {
    renderSettings();
    expect(screen.getByRole('heading', { name: 'Your account', level: 1 })).toBeVisible();
    expect(screen.getByText('Mina')).toBeVisible();
    expect(screen.getByText('0-day streak')).toBeVisible();
    expect(screen.getByText('Level 1')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Account details', level: 2 })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Sign out', level: 2 })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Change password', level: 2 })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Back to your account' })).not.toBeInTheDocument();
  });

  test('shows the account email with a link to see plans', () => {
    renderSettings();
    expect(screen.getByText('player@example.com')).toBeVisible();
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/upgrade');
  });

  test('shows the streak and level', () => {
    renderSettings(meFixture({ player: player({ currentStreak: 4, xp: 130, level: 2 }) }));
    expect(screen.getByText('4-day streak')).toBeVisible();
    expect(screen.getByText('Level 2')).toBeVisible();
  });

  test('links to the player edit form', () => {
    renderSettings();
    expect(screen.getByRole('link', { name: 'Edit player' })).toHaveAttribute('href', '/player');
  });

  test('signs out through the injected handler', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn().mockResolvedValue(undefined);
    renderSettings(meFixture(), signOut);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(signOut).toHaveBeenCalledOnce();
  });

  test('reports a sign-out failure and keeps the page visible', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn().mockRejectedValue(new Error('HTTP failure'));
    renderSettings(meFixture(), signOut);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByText('Sign out failed.', { exact: true })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Your account' })).toBeVisible();
  });
});

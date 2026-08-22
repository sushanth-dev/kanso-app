import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router';
import { describe, expect, test, vi } from 'vitest';
import { type Me } from '../api/account-api.ts';
import { createAppRouter } from '../router.tsx';
import { SettingsScreen } from './settings-route.tsx';

vi.mock('../auth-client.ts', () => ({
  authClient: { changePassword: vi.fn() },
}));

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

function renderSettings(signOut = vi.fn().mockResolvedValue(undefined)) {
  const history = createMemoryHistory();
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <SettingsScreen me={meFixture} signOut={signOut} />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
}

describe('SettingsScreen', () => {
  test('renders the heading, back link, sign out, and change password', () => {
    renderSettings();
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to your account' })).toHaveAttribute(
      'href',
      '/account',
    );
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Change password' })).toBeVisible();
  });

  test('shows the account email with a link to see plans', () => {
    renderSettings();
    expect(screen.getByText('player@example.com')).toBeVisible();
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute(
      'href',
      '/account/upgrade',
    );
  });

  test('signs out through the injected handler', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn().mockResolvedValue(undefined);
    renderSettings(signOut);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(signOut).toHaveBeenCalledOnce();
  });

  test('reports a sign-out failure and keeps the page visible', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn().mockRejectedValue(new Error('HTTP failure'));
    renderSettings(signOut);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByText('Sign out failed.', { exact: true })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });
});

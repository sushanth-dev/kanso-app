import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router';
import { describe, expect, test, vi } from 'vitest';
import type { Me, Player } from '../api/account-api.ts';
import { createAppRouter } from '../router.tsx';
import { AccountScreen } from './account-route.tsx';

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
    players: [player()],
    ...overrides,
  };
}

function renderAccount(me: Me = meFixture(), signOut = vi.fn().mockResolvedValue(undefined)) {
  const history = createMemoryHistory();
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  return render(
    <RouterContextProvider router={router}>
      <AccountScreen me={me} signOut={signOut} />
    </RouterContextProvider>,
  );
}

describe('AccountScreen', () => {
  test('renders account identity and the owned players', () => {
    renderAccount();
    expect(screen.getByRole('heading', { name: 'Your account' })).toBeVisible();
    expect(screen.getByText('Mina')).toBeVisible();
    expect(screen.getByText('player@example.com')).toBeVisible();
    expect(screen.getByText('Free')).toBeVisible();
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

  test('shows the owned empty-state message when there are no owned players', () => {
    renderAccount(meFixture({ players: [] }));
    expect(screen.getByText('No players yet')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Create player' })).toHaveAttribute(
      'href',
      '/account/players/new',
    );
  });

  test('owned cards link to edit', () => {
    renderAccount();
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      `/account/players/${playerId}/edit`,
    );
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveClass('min-w-11', 'justify-center');
  });
});

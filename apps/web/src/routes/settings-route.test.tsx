import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError, type Me, type Player } from '../api/account-api.ts';
import { accountApi } from '../api/account-api.ts';
import { ME_QUERY_KEY } from '../query-client.ts';
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
        <SettingsScreen
          me={me}
          signOut={signOut}
          accountApi={accountApi}
          queryClient={queryClient}
        />
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
    expect(screen.getByRole('heading', { name: 'Default usernames', level: 2 })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Security', level: 2 })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Sign out', level: 3 })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Change password', level: 3 })).toBeVisible();
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

  test('prefills the default usernames from the player', () => {
    renderSettings(
      meFixture({
        player: player({ chesscomUsername: 'mina-chess', lichessUsername: 'mina-lichess' }),
      }),
    );
    expect(screen.getByLabelText('Chess.com username')).toHaveValue('mina-chess');
    expect(screen.getByLabelText('Lichess username')).toHaveValue('mina-lichess');
  });

  test('saves the default usernames through PATCH /me', async () => {
    const user = userEvent.setup();
    const updateMe = vi
      .spyOn(accountApi, 'updateMe')
      .mockResolvedValue(
        player({ chesscomUsername: 'mina-chess', lichessUsername: 'mina-lichess' }),
      );
    renderSettings();

    await user.type(screen.getByLabelText('Chess.com username'), 'mina-chess');
    await user.type(screen.getByLabelText('Lichess username'), 'mina-lichess');
    await user.click(screen.getByRole('button', { name: 'Save default usernames' }));

    expect(await screen.findByText('Default usernames saved.')).toBeVisible();
    expect(updateMe).toHaveBeenCalledWith({
      chesscomUsername: 'mina-chess',
      lichessUsername: 'mina-lichess',
    });
  });

  test('shows the change-password form only after the reveal button is clicked', async () => {
    const user = userEvent.setup();
    renderSettings();

    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByLabelText('Current password')).toBeVisible();
  });

  test('reports a non-401 username save failure and keeps the form', async () => {
    const user = userEvent.setup();
    vi.spyOn(accountApi, 'updateMe').mockRejectedValue(
      new ApiRequestError(500, 'internal', undefined, 'boom'),
    );
    renderSettings();

    await user.type(screen.getByLabelText('Chess.com username'), 'mina-chess');
    await user.click(screen.getByRole('button', { name: 'Save default usernames' }));

    expect(await screen.findByText('The default usernames could not be saved.')).toBeVisible();
    expect(screen.getByLabelText('Chess.com username')).toBeVisible();
  });

  test('clears the me cache on a 401 while saving default usernames', async () => {
    const user = userEvent.setup();
    vi.spyOn(accountApi, 'updateMe').mockRejectedValue(
      new ApiRequestError(401, 'unauthorized', undefined, 'No session.'),
    );
    const queryClient = new QueryClient();
    const history = createMemoryHistory();
    const router = createAppRouter({ history, queryClient });
    queryClient.setQueryData(ME_QUERY_KEY, meFixture());
    render(
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          <SettingsScreen
            me={meFixture()}
            signOut={vi.fn().mockResolvedValue(undefined)}
            accountApi={accountApi}
            queryClient={queryClient}
          />
        </RouterContextProvider>
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText('Chess.com username'), 'mina-chess');
    await user.click(screen.getByRole('button', { name: 'Save default usernames' }));

    await waitFor(() => {
      expect(queryClient.getQueryData(ME_QUERY_KEY)).toBeUndefined();
    });
  });

  // ST-104. The Appearance section writes the real theme attribute and the
  // real localStorage key, so these tests reset both after themselves.
  afterEach(() => {
    document.documentElement.removeAttribute('data-contrast');
    localStorage.clear();
  });

  test('renders the Appearance section with both contrast options', () => {
    renderSettings();
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeVisible();
    expect(screen.getByRole('radiogroup', { name: 'Contrast' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Standard' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'High contrast' })).toBeVisible();
  });

  test('choosing High contrast sets the scope attribute and stores the choice', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByLabelText('High contrast'));

    expect(document.documentElement.getAttribute('data-contrast')).toBe('high');
    expect(localStorage.getItem('kanso-contrast')).toBe('high');
  });

  test('choosing Standard clears the scope attribute and stores the choice', async () => {
    document.documentElement.setAttribute('data-contrast', 'high');
    localStorage.setItem('kanso-contrast', 'high');
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByLabelText('Standard'));

    expect(document.documentElement.hasAttribute('data-contrast')).toBe(false);
    expect(localStorage.getItem('kanso-contrast')).toBe('standard');
  });

  test('delete account reveals the password form only behind the danger button', async () => {
    const user = userEvent.setup();
    renderSettings();

    expect(screen.queryByLabelText('Confirm with your password')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(await screen.findByLabelText('Confirm with your password')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Delete forever' })).toBeDisabled();
  });

  test('a wrong password shows the API refusal and keeps the account', async () => {
    const user = userEvent.setup();
    const deleteMe = vi
      .spyOn(accountApi, 'deleteMe')
      .mockRejectedValue(
        new ApiRequestError(403, 'wrong_password', undefined, 'That password is not right.'),
      );
    renderSettings();

    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await user.type(await screen.findByLabelText('Confirm with your password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Delete forever' }));

    expect(await screen.findByText('That password is not right.')).toBeVisible();
    expect(deleteMe).toHaveBeenCalledWith({ password: 'wrong' });
  });

  test('a confirmed delete signs the player out', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(accountApi, 'deleteMe').mockResolvedValue(undefined);
    renderSettings(meFixture(), signOut);

    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await user.type(
      screen.getByLabelText('Confirm with your password'),
      'correct horse battery staple',
    );
    await user.click(screen.getByRole('button', { name: 'Delete forever' }));

    await waitFor(() => expect(signOut).toHaveBeenCalled());
  });
});

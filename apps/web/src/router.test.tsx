import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { accountApi, ApiRequestError } from './api/account-api.ts';
import type * as AccountApi from './api/account-api.ts';
import { authClient } from './auth-client.ts';
import { ME_QUERY_KEY } from './query-client.ts';
import { createAppRouter } from './router.tsx';

vi.mock('./api/account-api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof AccountApi>();
  return {
    ...actual,
    accountApi: {
      getMe: vi.fn(),
      updateMe: vi.fn(),
    },
  };
});

vi.mock('./auth-client.ts', () => ({
  authClient: {
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
    signOut: vi.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- accountApi.getMe is a vi.fn() from the module mock.
const getMe = vi.mocked(accountApi.getMe);
const signOut = vi.mocked(authClient.signOut);

const ownedPlayerId = '00000000-0000-4000-8000-000000000001';

const ownedPlayer = {
  id: ownedPlayerId,
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
};

const meFixture = {
  userId: 'user-1',
  email: 'player@example.com',
  name: 'Player',
  tier: 'beginner' as const,
  player: ownedPlayer,
};

function renderAt(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

describe('router', () => {
  beforeEach(() => {
    getMe.mockReset();
    signOut.mockReset();
    signOut.mockResolvedValue({ data: { success: true }, error: null });
  });

  test('renders the landing page at /', async () => {
    renderAt('/');
    expect(
      await screen.findByRole('heading', {
        name: 'Know the one thing to fix after every tournament.',
      }),
    ).toBeVisible();
  });

  test('redirects /settings to /sign-in when getMe returns 401', async () => {
    getMe.mockRejectedValue(new ApiRequestError(401, 'unauthorized', undefined, 'No session.'));
    renderAt('/settings');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('recovers from a 500 fallback via Retry once getMe succeeds', async () => {
    const user = userEvent.setup();
    getMe.mockRejectedValue(new ApiRequestError(500, 'server_error', undefined, 'Boom.'));
    const { router } = renderAt('/settings');
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeVisible();

    getMe.mockResolvedValue(meFixture);
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/settings');
  });

  test('sign-out navigates away before clearing the me query, then lands on /sign-in', async () => {
    const user = userEvent.setup();
    getMe.mockResolvedValue(meFixture);
    signOut.mockResolvedValue({ data: { success: true }, error: null });
    const { router, queryClient } = renderAt('/settings');
    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeVisible();

    queryClient.setQueryData(ME_QUERY_KEY, meFixture);
    let pathAtRemoval: string | undefined;
    const removeQueries = queryClient.removeQueries.bind(queryClient);
    const removeSpy = vi.spyOn(queryClient, 'removeQueries').mockImplementation((filters) => {
      pathAtRemoval = router.state.location.pathname;
      removeQueries(filters);
    });

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(signOut).toHaveBeenCalledOnce();
    expect(removeSpy).toHaveBeenCalledOnce();
    expect(removeSpy).toHaveBeenCalledWith({ queryKey: ME_QUERY_KEY });
    expect(signOut.mock.invocationCallOrder[0]).toBeLessThan(
      removeSpy.mock.invocationCallOrder[0] ?? 0,
    );
    expect(pathAtRemoval).toBe('/sign-in');
    expect(queryClient.getQueryData(ME_QUERY_KEY)).toBeUndefined();
    expect(router.state.location.pathname).toBe('/sign-in');
  });

  test('retains the account cache and page when sign-out resolves with an error', async () => {
    const user = userEvent.setup();
    getMe.mockResolvedValue(meFixture);
    signOut.mockResolvedValue({
      data: null,
      error: { status: 500, statusText: 'Internal Server Error' },
    });
    const { router, queryClient } = renderAt('/settings');
    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeVisible();
    queryClient.setQueryData(ME_QUERY_KEY, meFixture);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByText('Sign out failed.', { exact: true })).toBeVisible();
    expect(queryClient.getQueryData(ME_QUERY_KEY)).toEqual(meFixture);
    expect(router.state.location.pathname).toBe('/settings');
  });

  test('renders the edit form at /player', async () => {
    getMe.mockResolvedValue(meFixture);
    renderAt('/player');
    expect(await screen.findByRole('heading', { name: 'Edit player' })).toBeVisible();
  });

  test('renders the import screen at /import', async () => {
    getMe.mockResolvedValue(meFixture);
    renderAt('/import');
    expect(await screen.findByRole('heading', { name: 'Import games' })).toBeVisible();
  });

  test('renders the merged account and settings page at /settings', async () => {
    getMe.mockResolvedValue(meFixture);
    renderAt('/settings');
    expect(await screen.findByRole('heading', { name: 'Your account', level: 1 })).toBeVisible();
    expect(await screen.findByText('0-day streak')).toBeVisible();
    expect(screen.getByText('Level 1')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Account details' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Back to your account' })).not.toBeInTheDocument();
  });

  test('shows every authenticated route in the header nav on the account section', async () => {
    getMe.mockResolvedValue(meFixture);
    renderAt('/settings');
    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeVisible();
    const nav = screen.getByRole('navigation', { name: 'Account' });
    const expected = [
      ['Report', '/report'],
      ['Focus', '/focus'],
      ['Proof sheet', '/proof-sheet'],
      ['Rating gap', '/transfer-gap'],
      ['Games', '/games'],
      ['Tournaments', '/tournaments'],
      ['Import', '/import'],
      ['Plans', '/upgrade'],
      ['Settings', '/settings'],
    ] as const;
    for (const [label, href] of expected) {
      const link = within(nav).getByRole('link', { name: label });
      expect(link).toHaveAttribute('href', href);
    }
    expect(within(nav).queryByRole('link', { name: 'Account' })).not.toBeInTheDocument();
  });

  test('redirects /settings to the guardian waiting screen when consent is required', async () => {
    getMe.mockRejectedValue(
      new ApiRequestError(
        403,
        'consent_required',
        undefined,
        'A guardian must confirm consent before you can use KansoChess.',
      ),
    );
    renderAt('/settings');
    expect(
      await screen.findByRole('heading', { name: 'Waiting for guardian consent' }),
    ).toBeVisible();
  });

  test('renders the guardian waiting screen directly when consent is required', async () => {
    getMe.mockRejectedValue(
      new ApiRequestError(
        403,
        'consent_required',
        undefined,
        'A guardian must confirm consent before you can use KansoChess.',
      ),
    );
    renderAt('/guardians/waiting');
    expect(
      await screen.findByRole('heading', { name: 'Waiting for guardian consent' }),
    ).toBeVisible();
  });
});

import { render, screen } from '@testing-library/react';
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
      createPlayer: vi.fn(),
      updatePlayer: vi.fn(),
      attachGuardian: vi.fn(),
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

const meFixture = {
  userId: 'user-1',
  email: 'player@example.com',
  name: 'Player',
  tier: 'free' as const,
  players: [],
  guardedPlayers: [],
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
  });

  test('redirects / to /account', async () => {
    getMe.mockResolvedValue(meFixture);
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeVisible();
  });

  test('redirects /account to /sign-in when getMe returns 401', async () => {
    getMe.mockRejectedValue(new ApiRequestError(401, 'unauthorized', undefined, 'No session.'));
    renderAt('/account');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('recovers from a 500 fallback via Retry once getMe succeeds', async () => {
    const user = userEvent.setup();
    getMe.mockRejectedValue(new ApiRequestError(500, 'server_error', undefined, 'Boom.'));
    const { router } = renderAt('/account');
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeVisible();

    getMe.mockResolvedValue(meFixture);
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/account');
  });

  test('sign-out clears the me query before navigating away, then lands on /sign-in', async () => {
    const user = userEvent.setup();
    getMe.mockResolvedValue(meFixture);
    const { router, queryClient } = renderAt('/account');
    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeVisible();

    let pathAtRemoval: string | undefined;
    const removeSpy = vi.spyOn(queryClient, 'removeQueries').mockImplementation(() => {
      pathAtRemoval = router.state.location.pathname;
    });

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(signOut).toHaveBeenCalledOnce();
    expect(removeSpy).toHaveBeenCalledOnce();
    expect(removeSpy).toHaveBeenCalledWith({ queryKey: ME_QUERY_KEY });
    expect(signOut.mock.invocationCallOrder[0]).toBeLessThan(
      removeSpy.mock.invocationCallOrder[0] ?? 0,
    );
    expect(pathAtRemoval).toBe('/account');
    expect(router.state.location.pathname).toBe('/sign-in');
  });
});

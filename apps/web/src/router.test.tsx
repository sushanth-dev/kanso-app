import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { accountApi, ApiRequestError } from './api/account-api.ts';
import type * as AccountApi from './api/account-api.ts';
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

// eslint-disable-next-line @typescript-eslint/unbound-method -- accountApi.getMe is a vi.fn() from the module mock.
const getMe = vi.mocked(accountApi.getMe);

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
  return router;
}

describe('router', () => {
  beforeEach(() => {
    getMe.mockReset();
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

  test('renders the fallback with a Retry button instead of a blank document on a 500', async () => {
    getMe.mockRejectedValue(new ApiRequestError(500, 'server_error', undefined, 'Boom.'));
    renderAt('/account');
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeVisible();
  });
});

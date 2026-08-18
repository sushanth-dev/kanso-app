import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { accountApi } from '../api/account-api.ts';
import type * as AccountApi from '../api/account-api.ts';
import { createAppRouter } from '../router.tsx';

vi.mock('../api/account-api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof AccountApi>();
  return {
    ...actual,
    accountApi: { getMe: vi.fn(), createPlayer: vi.fn(), updatePlayer: vi.fn() },
  };
});

vi.mock('../auth-client.ts', () => ({
  authClient: {
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
    signOut: vi.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- getMe is a vi.fn() from the module mock.
const getMe = vi.mocked(accountApi.getMe);

function renderAt(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('UpgradeRoute', () => {
  beforeEach(() => {
    getMe.mockResolvedValue({
      userId: 'user-1',
      email: 'player@example.com',
      name: 'Player',
      tier: 'free',
      players: [],
    });
  });

  test('states the boundary and the three prices', async () => {
    renderAt('/account/upgrade');

    expect(
      await screen.findByRole('heading', { name: 'Upgrade to the full loop' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Your first diagnosis is free/)).toBeInTheDocument();
    expect(screen.getByText('$15')).toBeInTheDocument();
    expect(screen.getByText('$130')).toBeInTheDocument();
    expect(screen.getByText('$150')).toBeInTheDocument();
  });

  test('gives each plan a pay button', async () => {
    renderAt('/account/upgrade');

    expect(await screen.findByRole('button', { name: 'Pay $15' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay $130' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay $150' })).toBeInTheDocument();
  });
});

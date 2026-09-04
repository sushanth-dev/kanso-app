/**
 * The account shell's brand: the wordmark is a link to the product's front
 * door - the report for a signed-in account, the landing page otherwise
 * (ST-124).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { accountApi, ApiRequestError, type Me } from '../api/account-api.ts';
import { createAppRouter } from '../router.tsx';
import { StatusMessageProvider } from './status-message.tsx';
import { PageFrame } from './page-frame.tsx';

const meFixture: Me = {
  userId: 'user-1',
  email: 'player@example.com',
  name: 'Player',
  tier: 'beginner',
  player: {
    id: '00000000-0000-4000-8000-000000000001',
    displayName: 'Mina',
    birthYear: null,
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

function renderFrame() {
  const history = createMemoryHistory({ initialEntries: ['/puzzles'] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  return render(
    <QueryClientProvider client={queryClient}>
      <StatusMessageProvider>
        <RouterContextProvider router={router}>
          <PageFrame>
            <p>Content</p>
          </PageFrame>
        </RouterContextProvider>
      </StatusMessageProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(accountApi, 'getMe');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PageFrame brand link', () => {
  test('a signed-in account links the wordmark to the report', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    renderFrame();
    const brand = await screen.findByRole('link', { name: 'Kanso Chess' });
    await waitFor(() => expect(brand.getAttribute('href')).toBe('/report'));
  });

  test('a signed-out visitor links the wordmark to the landing page', async () => {
    vi.spyOn(accountApi, 'getMe').mockRejectedValue(
      new ApiRequestError(401, 'no_session', [], 'No session.'),
    );
    renderFrame();
    const brand = await screen.findByRole('link', { name: 'Kanso Chess' });
    await waitFor(() => expect(brand.getAttribute('href')).toBe('/'));
  });
});

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { accountApi, ApiRequestError, type Me } from '../api/account-api.ts';
import { diagnosisApi } from '../api/diagnosis-api.ts';
import { createAppRouter } from '../router.tsx';

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

function renderAt(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('TransferGapRoute', () => {
  beforeEach(() => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('shows the ratings and the gap for each platform', async () => {
    vi.spyOn(diagnosisApi, 'getTransferGap').mockResolvedValue({
      playerId: '00000000-0000-4000-8000-000000000001',
      overTheBoardRating: 1300,
      chesscom: { rating: 1500, gap: 200 },
      lichess: { rating: 1280, gap: -20 },
    });

    renderAt('/transfer-gap');

    expect(await screen.findByRole('heading', { name: 'Rating transfer gap' })).toBeVisible();
    expect(await screen.findByText('1300')).toBeVisible();
    expect(screen.getByText('1500')).toBeVisible();
    expect(screen.getByText('+200')).toBeVisible();
    expect(screen.getByText('1280')).toBeVisible();
    expect(screen.getByText('-20')).toBeVisible();
  });

  test('shows an EmptyState when the gap fails to load', async () => {
    vi.spyOn(diagnosisApi, 'getTransferGap').mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Server error.'),
    );

    renderAt('/transfer-gap');

    expect(
      await screen.findByRole('heading', { name: 'Your rating gap could not be loaded' }),
    ).toBeVisible();
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { accountApi, ApiRequestError, type Me } from '../api/account-api.ts';
import { diagnosisApi, type TransferGap, type TransferGapSeries } from '../api/diagnosis-api.ts';
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

const seriesFixture: TransferGapSeries = {
  playerId: '00000000-0000-4000-8000-000000000001',
  platform: 'chesscom',
  onlineRating: 1900,
  points: [
    {
      tournamentId: '00000000-0000-4000-8000-00000000000a',
      name: 'Spring Open',
      date: '2026-03-14T09:00:00.000Z',
      rating: 1300,
      gap: 600,
    },
    {
      tournamentId: '00000000-0000-4000-8000-00000000000b',
      name: 'Autumn Open',
      date: '2026-09-05T09:00:00.000Z',
      rating: 1500,
      gap: 400,
    },
  ],
  skippedTournaments: 0,
};

function gapFixture(): TransferGap {
  return {
    playerId: '00000000-0000-4000-8000-000000000001',
    overTheBoardRating: 1300,
    chesscom: { rating: 1900, gap: 600 },
    lichess: { rating: null, gap: null },
  };
}

describe('TransferGapRoute', () => {
  beforeEach(() => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(diagnosisApi, 'getTransferGapSeries').mockResolvedValue(seriesFixture);
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
  test('shows a loading status while the gap is fetched', async () => {
    const { promise } = Promise.withResolvers<TransferGap>();
    vi.spyOn(diagnosisApi, 'getTransferGap').mockReturnValue(promise);

    renderAt('/transfer-gap');

    expect(await screen.findByRole('status', { name: 'Loading rating gap' })).toBeVisible();
  });

  test('renders missing ratings and gaps as dashes, and zero without a sign', async () => {
    vi.spyOn(diagnosisApi, 'getTransferGap').mockResolvedValue({
      playerId: '00000000-0000-4000-8000-000000000001',
      overTheBoardRating: null,
      chesscom: { rating: null, gap: null },
      lichess: { rating: 1450, gap: 0 },
    });

    renderAt('/transfer-gap');

    expect(await screen.findByText('1450')).toBeVisible();
    // Over the board rating, both chess.com cells: four dashes in total.
    expect(screen.getAllByText('—')).toHaveLength(4);
    // The gap card's zero and the series chart's zero tick both read bare;
    // the contract is the missing sign, not a count.
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('+0')).not.toBeInTheDocument();
  });

  test('refresh pulls the ratings again from the platforms', async () => {
    const getTransferGap = vi.spyOn(diagnosisApi, 'getTransferGap').mockResolvedValue(gapFixture());

    renderAt('/transfer-gap');

    await screen.findByText('+600');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh ratings' }));
    await waitFor(() => {
      expect(getTransferGap).toHaveBeenCalledWith(true);
    });
  });

  test('the series chart names the reference and the season in its accessible name', async () => {
    vi.spyOn(diagnosisApi, 'getTransferGap').mockResolvedValue(gapFixture());

    renderAt('/transfer-gap');

    const chart = await screen.findByRole('img', {
      name:
        'Your gap to Chess.com rapid 1900 across 2 tournaments, ' +
        'from +600 at Spring Open to +400 at Autumn Open.',
    });
    expect(chart).toBeVisible();
    expect(screen.getByText('Chess.com rapid 1900')).toBeVisible();
  });

  test('one event draws its point and refuses to call it a trend', async () => {
    vi.spyOn(diagnosisApi, 'getTransferGap').mockResolvedValue(gapFixture());
    vi.spyOn(diagnosisApi, 'getTransferGapSeries').mockResolvedValue({
      ...seriesFixture,
      points: [seriesFixture.points[0]!],
    });

    renderAt('/transfer-gap');

    expect(
      await screen.findByText(
        'One tournament so far. The direction needs a second event - one point is not a trend.',
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('img', {
        name: 'Your gap to Chess.com rapid 1900 across 1 tournament: +600 at Spring Open.',
      }),
    ).toBeVisible();
  });

  test('a player with no tournaments is told to import one first', async () => {
    vi.spyOn(diagnosisApi, 'getTransferGap').mockResolvedValue(gapFixture());
    vi.spyOn(diagnosisApi, 'getTransferGapSeries').mockResolvedValue({
      ...seriesFixture,
      points: [],
      skippedTournaments: 0,
    });

    renderAt('/transfer-gap');

    expect(
      await screen.findByText(
        'No tournament games yet. Upload a tournament and the gap gets its first point.',
      ),
    ).toBeVisible();
  });

  test('unrated events are counted, not hidden', async () => {
    vi.spyOn(diagnosisApi, 'getTransferGap').mockResolvedValue(gapFixture());
    vi.spyOn(diagnosisApi, 'getTransferGapSeries').mockResolvedValue({
      ...seriesFixture,
      points: [],
      skippedTournaments: 2,
    });

    renderAt('/transfer-gap');

    expect(
      await screen.findByText(
        'None of your 2 tournaments carry a player rating in their games, so there is nothing to plot yet.',
      ),
    ).toBeVisible();
  });

  test('a missing online rating names the fetch it is waiting on', async () => {
    vi.spyOn(diagnosisApi, 'getTransferGap').mockResolvedValue(gapFixture());
    vi.spyOn(diagnosisApi, 'getTransferGapSeries').mockResolvedValue({
      ...seriesFixture,
      platform: null,
      onlineRating: null,
      points: [{ ...seriesFixture.points[0]!, gap: null }],
    });

    renderAt('/transfer-gap');

    expect(
      await screen.findByText(
        'No online rating fetched yet. Set a Chess.com or Lichess username on your account and refresh the ratings; every point reads against your latest online rating.',
      ),
    ).toBeVisible();
  });

  test('events skipped beside plotted points are mentioned, not hidden', async () => {
    vi.spyOn(diagnosisApi, 'getTransferGap').mockResolvedValue(gapFixture());
    vi.spyOn(diagnosisApi, 'getTransferGapSeries').mockResolvedValue({
      ...seriesFixture,
      skippedTournaments: 1,
    });

    renderAt('/transfer-gap');

    expect(
      await screen.findByText(
        'One other event carries no player rating in its games, so it has no point.',
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('img', {
        name:
          'Your gap to Chess.com rapid 1900 across 2 tournaments, ' +
          'from +600 at Spring Open to +400 at Autumn Open.',
      }),
    ).toBeVisible();
  });

  test('the series failing to load shows its own EmptyState', async () => {
    vi.spyOn(diagnosisApi, 'getTransferGap').mockResolvedValue(gapFixture());
    vi.spyOn(diagnosisApi, 'getTransferGapSeries').mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Server error.'),
    );

    renderAt('/transfer-gap');

    expect(
      await screen.findByRole('heading', { name: 'The gap series could not be loaded' }),
    ).toBeVisible();
  });
});

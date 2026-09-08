import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { accountApi, ApiRequestError, type Me } from '../api/account-api.ts';
import { diagnosisApi, type PracticeQueue, type PracticeQueueItem } from '../api/diagnosis-api.ts';
import { createAppRouter } from '../router.tsx';
import { drillHref, groupLabel } from './puzzles-route.tsx';

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

function queueItem(overrides: Partial<PracticeQueueItem> = {}): PracticeQueueItem {
  return {
    puzzleId: '00000000-0000-4000-8000-00000000d001',
    fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
    moves: 'e4 e5 Nf3',
    rating: 1420,
    kind: 'motif',
    group: 'missed_capture',
    reviewLevel: 1,
    nextReviewAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    solved: false,
    attempts: 0,
    ...overrides,
  };
}

function queueFixture(overrides: Partial<PracticeQueue> = {}): PracticeQueue {
  return { due: [], upcoming: [], mastered: [], ...overrides };
}

function renderAt(path = '/puzzles') {
  const history = createMemoryHistory({ initialEntries: [path] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient, router };
}

describe('PuzzlesRoute helpers', () => {
  test('turns camelCase and snake_case slugs into a labelled phrase', () => {
    expect(groupLabel('hangingPiece')).toBe('Hanging piece');
    expect(groupLabel('missed_capture')).toBe('Missed capture');
  });

  test('builds the tournament-stream drill link with the group encoded', () => {
    expect(drillHref('motif', 'missed_capture')).toBe(
      '/practice?kind=motif&group=missed_capture&stream=tournament',
    );
    expect(drillHref('motif', 'won endgame')).toBe(
      '/practice?kind=motif&group=won%20endgame&stream=tournament',
    );
  });
});

describe('PuzzlesRoute', () => {
  beforeEach(() => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('shows a loading status while the queue is fetched', async () => {
    const { promise } = Promise.withResolvers<PracticeQueue>();
    vi.spyOn(diagnosisApi, 'getPracticeQueue').mockReturnValue(promise);

    renderAt();

    const statuses = await screen.findAllByRole('status');
    expect(statuses.length).toBeGreaterThan(0);
  });

  test('renders the pending drill list with a practice-now link and due badges', async () => {
    vi.spyOn(diagnosisApi, 'getPracticeQueue').mockResolvedValue(
      queueFixture({
        due: [queueItem(), queueItem({ puzzleId: 'p2', group: 'hangingPiece', rating: 1350 })],
      }),
    );

    renderAt();

    expect(await screen.findByRole('heading', { name: 'Puzzles' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Practice now' })).toHaveAttribute(
      'href',
      '/practice?kind=motif&group=missed_capture&stream=tournament',
    );
    expect(screen.getByText('Missed capture')).toBeVisible();
    expect(screen.getByText('Hanging piece')).toBeVisible();
    expect(screen.getByText('1420')).toBeVisible();
    expect(screen.getByText('1350')).toBeVisible();
    expect(screen.getAllByText('Due now')).toHaveLength(2);
  });

  test('ST-144: the queue enters on the system, and its tabs and links hold the touch floor', async () => {
    vi.spyOn(diagnosisApi, 'getPracticeQueue').mockResolvedValue(
      queueFixture({
        due: [queueItem(), queueItem({ puzzleId: 'p2', group: 'hangingPiece', rating: 1350 })],
      }),
    );

    renderAt();

    expect(
      (await screen.findByRole('heading', { name: 'Puzzles' })).closest('.reveal-in'),
    ).not.toBeNull();
    expect(screen.getByRole('navigation', { name: 'Queue tabs' })).toHaveClass('reveal-in');
    for (const name of [/Pending \(\d+\)/, /Upcoming \(\d+\)/, /Mastered \(\d+\)/]) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-11');
    }
    // Tab panels swap instantly on flip; only the page chrome enters (the
    // stagger replays belong to page load, not to rapid tab changes).
    expect(screen.getAllByRole('list').some((el) => el.classList.contains('stagger-in'))).toBe(
      false,
    );
    expect(screen.getByRole('link', { name: 'Practice now' })).toHaveClass('min-h-11');
  });

  test('shows the all-caught-up empty state with a link to the report', async () => {
    vi.spyOn(diagnosisApi, 'getPracticeQueue').mockResolvedValue(queueFixture());

    renderAt();

    expect(await screen.findByRole('heading', { name: 'All caught up!' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Go to your report' })).toHaveAttribute(
      'href',
      '/report',
    );
  });

  test('shows the review horizon for upcoming puzzles, one day out as tomorrow', async () => {
    vi.spyOn(diagnosisApi, 'getPracticeQueue').mockResolvedValue(
      queueFixture({
        upcoming: [
          queueItem({ nextReviewAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }),
          queueItem({
            puzzleId: 'p3',
            group: 'pawnEndgame',
            reviewLevel: 2,
            nextReviewAt: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString(),
          }),
        ],
      }),
    );

    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'Upcoming (2)' }));

    expect(await screen.findByText('Due tomorrow')).toBeVisible();
    expect(screen.getByText('Due in 40 days')).toBeVisible();
    expect(screen.getByText('Box 1')).toBeVisible();
    expect(screen.getByText('Box 2')).toBeVisible();
  });

  test('shows box badges only inside review levels 1 to 3', async () => {
    vi.spyOn(diagnosisApi, 'getPracticeQueue').mockResolvedValue(
      queueFixture({
        upcoming: [
          queueItem({ puzzleId: 'p4', reviewLevel: 0 }),
          queueItem({ puzzleId: 'p5', reviewLevel: 4, group: 'openingBlunder' }),
        ],
      }),
    );

    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'Upcoming (2)' }));

    expect(await screen.findByText('Opening blunder')).toBeVisible();
    expect(screen.getByText('Missed capture')).toBeVisible();
    expect(screen.queryByText(/^Box /)).not.toBeInTheDocument();
  });

  test('shows the not-scheduled empty state for an empty upcoming tab', async () => {
    vi.spyOn(diagnosisApi, 'getPracticeQueue').mockResolvedValue(queueFixture());

    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'Upcoming (0)' }));

    expect(await screen.findByRole('heading', { name: 'Nothing scheduled yet' })).toBeVisible();
  });

  test('lists mastered puzzles with success badges', async () => {
    vi.spyOn(diagnosisApi, 'getPracticeQueue').mockResolvedValue(
      queueFixture({ mastered: [queueItem({ solved: true, reviewLevel: 5 })] }),
    );

    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'Mastered (1)' }));

    expect(await screen.findByText('Missed capture')).toBeVisible();
    expect(screen.getByText('Mastered')).toBeVisible();
  });

  test('shows the nothing-mastered empty state for an empty mastered tab', async () => {
    vi.spyOn(diagnosisApi, 'getPracticeQueue').mockResolvedValue(queueFixture());

    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'Mastered (0)' }));

    expect(await screen.findByRole('heading', { name: 'Nothing mastered yet' })).toBeVisible();
  });

  test('marks the active tab as pressed and moves between tabs', async () => {
    vi.spyOn(diagnosisApi, 'getPracticeQueue').mockResolvedValue(queueFixture());

    renderAt();

    const pending = await screen.findByRole('button', { name: 'Pending (0)' });
    expect(pending).toHaveAttribute('aria-pressed', 'true');
    const upcoming = screen.getByRole('button', { name: 'Upcoming (0)' });
    expect(upcoming).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(upcoming);
    expect(upcoming).toHaveAttribute('aria-pressed', 'true');
    expect(pending).toHaveAttribute('aria-pressed', 'false');
  });

  test('recovers through the Retry action after a failed load', async () => {
    const getQueue = vi
      .spyOn(diagnosisApi, 'getPracticeQueue')
      .mockRejectedValueOnce(new ApiRequestError(500, 'internal_error', undefined, 'Server error.'))
      .mockResolvedValue(queueFixture({ due: [queueItem()] }));

    renderAt();

    expect(
      await screen.findByRole('heading', { name: 'This page could not be loaded' }),
    ).toBeVisible();
    expect(
      screen.getByText(
        'The drill queue could not be reached. Try again, or go back to your report.',
      ),
    ).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'Puzzles' })).toBeVisible();
    expect(getQueue).toHaveBeenCalledTimes(2);
  });

  test('a dead session returns the player to sign-in', async () => {
    vi.spyOn(diagnosisApi, 'getPracticeQueue').mockRejectedValue(
      new ApiRequestError(401, 'unauthorized', undefined, 'No session.'),
    );
    const history = createMemoryHistory({ initialEntries: ['/puzzles'] });
    const queryClient = new QueryClient();
    const router = createAppRouter({ history, queryClient });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/sign-in');
    });
    expect(screen.queryByRole('heading', { name: 'Puzzles' })).not.toBeInTheDocument();
  });
});

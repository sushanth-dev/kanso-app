/**
 * ST-152. The drill surface's debt card: the group's own row from the
 * patterns read, the honest line for a group that never mastered, and a
 * broken read that costs the drill nothing.
 *
 * ST-151. The retired headline mounts above the due-reviews list on the
 * queue-less practice surface, reading the same patterns endpoint the
 * report's headline reads.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { accountApi, type Me } from '../api/account-api.ts';
import { diagnosisApi, type PatternReport, type PracticeReviewItem } from '../api/diagnosis-api.ts';
import { createAppRouter } from '../router.tsx';
import { DrillCard, PracticeDebtCard } from './practice-route.tsx';

/** The pause the drill uses before the setup move; must match the route. */
const MOVE_PAUSE_MS = 600;

function square(name: string): HTMLElement {
  const el = document.querySelector(`[data-square="${name}"]`);
  if (el === null) throw new Error(`no square ${name}`);
  return el as HTMLElement;
}

function playMove(from: string, to: string): void {
  fireEvent.click(square(from));
  fireEvent.click(square(to));
}

const playerId = '00000000-0000-4000-8000-000000000001';

const meFixture: Me = {
  userId: 'user-1',
  email: 'player@example.com',
  name: 'Player',
  tier: 'beginner',
  analyticsSuiteAllowed: false,
  player: {
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
  },
};

function reviewFixture(overrides: Partial<PracticeReviewItem> = {}): PracticeReviewItem {
  return {
    puzzleId: '00000000-0000-4000-8000-0000000000f1',
    kind: 'motif',
    group: 'hanging_piece',
    reviewLevel: 1,
    ...overrides,
  };
}

function patternsFixture(patterns: PatternReport['patterns']): PatternReport {
  return { playerId, stream: 'tournament', verificationFloor: 10, patterns };
}

function patternFixture() {
  return {
    kind: 'motif' as const,
    groupKey: 'hanging_piece',
    label: 'Hanging piece',
    stream: 'tournament' as const,
    state: 'candidate' as const,
    masteredAt: '2026-08-01T00:00:00.000Z',
    retiredAt: null,
    cameBackAt: null,
    lastAlertGame: null,
    windowGames: 6,
    windowInstances: 3,
    windowCost: 187.5,
    relapses: 0,
    calibration: null,
  };
}

function renderDebtCard() {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <PracticeDebtCard kind="motif" group="hanging_piece" stream="tournament" />
    </QueryClientProvider>,
  );
}

describe('PracticeDebtCard', () => {
  test('renders the group’s debt card from the patterns read', async () => {
    vi.spyOn(diagnosisApi, 'getPatterns').mockResolvedValue(patternsFixture([patternFixture()]));

    renderDebtCard();

    expect(await screen.findByText('Hanging piece')).toBeVisible();
    expect(screen.getByText('3 instances · 187.5 half-points')).toBeVisible();
  });

  test('a group that never mastered names what starts its window', async () => {
    vi.spyOn(diagnosisApi, 'getPatterns').mockResolvedValue(patternsFixture([]));

    renderDebtCard();

    expect(
      await screen.findByText(/Not on the debt board yet: drill the group to mastery/),
    ).toBeVisible();
  });

  test('a broken board read never blocks the drill', async () => {
    vi.spyOn(diagnosisApi, 'getPatterns').mockRejectedValue(new Error('down'));

    renderDebtCard();

    expect(await screen.findByText(/The debt board could not load/)).toBeVisible();
  });

  test('a pending read renders nothing and the drill starts', () => {
    const { promise } = Promise.withResolvers<PatternReport>();
    vi.spyOn(diagnosisApi, 'getPatterns').mockReturnValue(promise);

    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <PracticeDebtCard kind="motif" group="hanging_piece" stream="tournament" />
      </QueryClientProvider>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

function renderPracticeRoute() {
  const history = createMemoryHistory({ initialEntries: ['/practice'] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('PracticeRoute', () => {
  test('ST-151: the retired headline mounts above the due-reviews list', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(diagnosisApi, 'getPatterns').mockImplementation((stream) =>
      Promise.resolve(patternsFixture([])).then((report) => ({ ...report, stream })),
    );
    vi.spyOn(diagnosisApi, 'getPracticeReviews').mockResolvedValue({
      reviews: [reviewFixture()],
      remaining: 5,
    });

    renderPracticeRoute();

    const headline = await screen.findByRole('heading', { name: 'Mistakes eliminated' });
    const dueReviews = await screen.findByRole('heading', { name: 'Due for review' });
    expect(
      headline.compareDocumentPosition(dueReviews) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test('ST-151: the headline renders while due-reviews is still pending', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(diagnosisApi, 'getPatterns').mockImplementation((stream) =>
      Promise.resolve(patternsFixture([])).then((report) => ({ ...report, stream })),
    );
    const { promise } = Promise.withResolvers<{
      reviews: PracticeReviewItem[];
      remaining: number;
    }>();
    vi.spyOn(diagnosisApi, 'getPracticeReviews').mockReturnValue(promise);

    renderPracticeRoute();

    expect(await screen.findByRole('heading', { name: 'Mistakes eliminated' })).toBeVisible();
    expect(screen.getByText('Checking what is due for review…')).toBeVisible();
  });

  test('ST-151: the headline renders when due-reviews fails to load', async () => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(diagnosisApi, 'getPatterns').mockImplementation((stream) =>
      Promise.resolve(patternsFixture([])).then((report) => ({ ...report, stream })),
    );
    vi.spyOn(diagnosisApi, 'getPracticeReviews').mockRejectedValue(new Error('down'));

    renderPracticeRoute();

    expect(await screen.findByRole('heading', { name: 'Mistakes eliminated' })).toBeVisible();
    expect(await screen.findByText('No weakness named')).toBeVisible();
  });
});

/**
 * Bug 23: the drill board must take a non-queen promotion and apply the
 * solution's stored piece. The puzzle parks a black pawn on a2; the white
 * setup move vacates a1, and the solution's answer promotes a knight.
 */
function promoPuzzle() {
  return {
    id: '00000000-0000-4000-8000-0000000000p1',
    fen: 'rnbqkbnr/p1pppppp/8/8/8/2N4P/pPPPPPP1/R1BQKBNR w Qkq - 0 6',
    moves: 'a1b1 a2a1n',
    rating: 1200,
  };
}

describe('DrillCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('a non-queen promotion plays the solution’s stored piece, not a queen', async () => {
    const onDone = vi.fn();
    render(<DrillCard puzzle={promoPuzzle()} onDone={onDone} />);

    // The white setup move plays itself; the board is then the player's.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MOVE_PAUSE_MS + 50);
    });

    // a2 to a1 is a promotion; the stored knight must land. The only black
    // queen stays the home one on d8 - a queen promotion would add a second.
    playMove('a2', 'a1');
    expect(screen.getAllByRole('img', { name: 'black knight' })).toHaveLength(3);
    expect(screen.getAllByRole('img', { name: 'black queen' })).toHaveLength(1);
  });
});

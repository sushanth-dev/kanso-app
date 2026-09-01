/**
 * ST-106. The drill screen against mocked API calls: the deal starts by
 * itself, the setup move plays itself, a wrong move costs a circle and
 * commits nothing, a solve records a solved drill and advances the queue, and
 * a missing or invalid group answers honestly.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { accountApi, type Me } from '../api/account-api.ts';
import { diagnosisApi, type PracticePuzzle, type PracticeSet } from '../api/diagnosis-api.ts';
import { createAppRouter } from '../router.tsx';

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

/**
 * Black to move: the setup move b8c6 plays itself, then White (the player)
 * must find g1f3. A second puzzle follows, so the queue's advance is visible.
 */
function puzzle(id: string, setup: string, solution: string): PracticePuzzle {
  return {
    id,
    // The knight still stands on g1: after the setup move (a black move)
    // the player, as White, must find g1f3.
    fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 1 2',
    moves: `${setup} ${solution}`,
    rating: 1500,
  };
}

function drillFixture(puzzles: PracticePuzzle[]): PracticeSet {
  return { kind: 'motif', group: 'hanging_piece', theme: 'hangingPiece', rating: 1500, puzzles };
}

function renderPath(path: string) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const history = createMemoryHistory({ initialEntries: [path] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { user, container: view.container };
}

function square(container: HTMLElement, name: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`rect[data-square="${name}"]`);
  if (element === null) throw new Error(`Square ${name} is not rendered.`);
  return element;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PracticeRoute', () => {
  test('an arrival without a group answers honestly', async () => {
    renderPath('/practice');
    expect(await screen.findByText('No weakness named')).toBeVisible();
  });

  test('the deal starts by itself: setup move, then the player finds the answer', async () => {
    const getPracticePuzzles = vi
      .spyOn(diagnosisApi, 'getPracticePuzzles')
      .mockResolvedValue(drillFixture([puzzle('p1', 'b8c6', 'g1f3')]));
    const record = vi
      .spyOn(diagnosisApi, 'recordPracticePuzzle')
      .mockResolvedValue({ attempts: 1, solved: true });
    const { user, container } = renderPath(
      '/practice?kind=motif&group=hanging_piece&label=Hung%20a%20piece&stream=tournament',
    );

    // The drill opens without a start button; the setup move plays itself.
    expect(await screen.findByText('Watch the setup move…')).toBeVisible();
    await vi.advanceTimersByTimeAsync(600);
    expect(await screen.findByText('Find the best move.')).toBeVisible();
    expect(getPracticePuzzles).toHaveBeenCalledWith('motif', 'hanging_piece');

    // The player's correct move solves the puzzle and records a solved drill.
    await user.click(square(container, 'g1'));
    await user.click(square(container, 'f3'));
    expect(await screen.findByText('Solved.')).toBeVisible();
    // The queue advances after the solve pause; the drill records on advance.
    await vi.advanceTimersByTimeAsync(600);
    expect(record).toHaveBeenCalledWith({
      puzzleId: 'p1',
      kind: 'motif',
      group: 'hanging_piece',
      solved: true,
    });
    expect(await screen.findByText('Drill complete')).toBeVisible();
  });

  test('a wrong move costs one circle and commits nothing', async () => {
    vi.spyOn(diagnosisApi, 'getPracticePuzzles').mockResolvedValue(
      drillFixture([puzzle('p1', 'b8c6', 'g1f3')]),
    );
    const record = vi
      .spyOn(diagnosisApi, 'recordPracticePuzzle')
      .mockResolvedValue({ attempts: 1, solved: false });
    const { user, container } = renderPath(
      '/practice?kind=motif&group=hanging_piece&label=Hung%20a%20piece&stream=tournament',
    );

    await screen.findByText('Watch the setup move…');
    await vi.advanceTimersByTimeAsync(600);
    await screen.findByText('Find the best move.');

    await user.click(square(container, 'a2'));
    await user.click(square(container, 'a3'));
    expect(await screen.findByText('Not the best move.')).toBeVisible();
    expect(screen.getByText('2 attempts left.')).toBeVisible();
    // Two circles still paint; the consumed one does not.
    const pips = container.querySelectorAll('span[aria-hidden="true"] > span');
    expect(pips).toHaveLength(3);
    expect(pips[0]).toHaveClass('bg-ink');
    expect(pips[1]).toHaveClass('bg-ink');
    expect(pips[2]).not.toHaveClass('bg-ink');
    expect(record).not.toHaveBeenCalled();
  });

  test('three misses reveal the solution and rotate the puzzle to the back', async () => {
    vi.spyOn(diagnosisApi, 'getPracticePuzzles').mockResolvedValue(
      drillFixture([puzzle('p1', 'b8c6', 'g1f3'), puzzle('p2', 'b8a6', 'g1f3')]),
    );
    const record = vi
      .spyOn(diagnosisApi, 'recordPracticePuzzle')
      .mockResolvedValue({ attempts: 1, solved: false });
    const { user, container } = renderPath(
      '/practice?kind=motif&group=hanging_piece&label=Hung%20a%20piece&stream=tournament',
    );

    await vi.advanceTimersByTimeAsync(600);
    await screen.findByText('Find the best move.');

    // Three wrong tries: a2-a3, then h2-h3, then a3-a4 after the revert.
    const wrong = async (from: string, to: string) => {
      await user.click(square(container, from));
      await user.click(square(container, to));
      await screen.findByText('Not the best move.');
    };
    await wrong('a2', 'a3');
    await wrong('h2', 'h3');
    // Wrong moves never commit, so the pawn is still on a2 for the third try;
    // the third miss leaves the playing state, so the reveal is what appears.
    await user.click(square(container, 'a2'));
    await user.click(square(container, 'a3'));
    expect(await screen.findByText('The solution.')).toBeVisible();
    // The reveal plays the solution, then the failed puzzle rotates to the
    // back and the second puzzle is dealt with its own setup move.
    await vi.advanceTimersByTimeAsync(2500);
    expect(await screen.findByText('Watch the setup move…')).toBeVisible();
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      puzzleId: 'p1',
      kind: 'motif',
      group: 'hanging_piece',
      solved: false,
    });
  });
});

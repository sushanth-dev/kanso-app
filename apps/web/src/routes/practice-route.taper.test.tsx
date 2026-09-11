/**
 * ST-157. The fatigue taper's pins: two failures never ease and three spread
 * wider than the window never ease, three inside the last five attempted
 * puzzles ease the session easiest-rating-first while the met ones keep
 * their rotation, the easing is one-way and says so in the header, and the
 * record call carries exactly the payload it always carried.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { diagnosisApi, type PracticePuzzle } from '../api/diagnosis-api.ts';
import { DrillSession } from './practice-route.tsx';

const MOVE_PAUSE_MS = 600;
const ROTATE_PAUSE_MS = 1200;

/**
 * The one-solution shape from the drill's own tests, re-rated per fixture:
 * the setup move (g8f6) plays itself, then white's Qxf7 (h5f7) is the only
 * move the player must find.
 */
function puzzle(id: string, rating: number): PracticePuzzle {
  return {
    id: `00000000-0000-4000-8000-0000000000${id}`,
    fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3',
    moves: 'g8f6 h5f7',
    rating,
  };
}

// The deal's order, worst first except the cheap c3 planted third, so an
// eased reorder of the undealt tail (f6, g7, h8) is visible against it.
const dealt = [
  puzzle('a1', 1800),
  puzzle('b2', 1750),
  puzzle('c3', 1000),
  puzzle('d4', 1650),
  puzzle('e5', 1700),
  puzzle('f6', 1550),
  puzzle('g7', 1600),
  puzzle('h8', 1500),
];

function square(name: string): HTMLElement {
  const el = document.querySelector(`[data-square="${name}"]`);
  if (el === null) throw new Error(`no square ${name}`);
  return el as HTMLElement;
}

function playMove(from: string, to: string): void {
  fireEvent.click(square(from));
  fireEvent.click(square(to));
}

/** Plays one puzzle to its outcome: a skip-solve or a three-miss reveal. */
async function attempt(solved: boolean): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(MOVE_PAUSE_MS + 50);
  });
  if (solved) {
    playMove('h5', 'f7');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MOVE_PAUSE_MS + 50);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
  } else {
    // Three legal-but-wrong queen moves burn the pips into the reveal.
    playMove('h5', 'h6');
    playMove('h5', 'g6');
    playMove('h5', 'h4');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * MOVE_PAUSE_MS + ROTATE_PAUSE_MS + 50);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROTATE_PAUSE_MS + 50);
    });
  }
}

function renderSession() {
  const record = vi.spyOn(diagnosisApi, 'recordPracticePuzzle').mockResolvedValue({
    attempts: 1,
    solved: true,
    reviewLevel: 2,
    nextReviewAt: '2026-09-12T00:00:00.000Z',
  });
  // The debt card degrades silently on a broken read; the drill never waits.
  vi.spyOn(diagnosisApi, 'getPatterns').mockRejectedValue(new Error('down'));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DrillSession
        puzzles={dealt}
        theme="endgame-rook"
        opening={null}
        label="Drill"
        kind="motif"
        group="endgame-rook"
        stream="online"
      />
    </QueryClientProvider>,
  );
  return record;
}

describe('DrillSession ST-157 fatigue tapering', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('two in the window, or three outside it, never ease: the deal order stands', async () => {
    const record = renderSession();

    // fail a1, fail b2, then three solves: two failures in the window.
    await attempt(false);
    await attempt(false);
    await attempt(true);
    await attempt(true);
    await attempt(true);
    expect(screen.queryByText(/Difficulty eased/)).toBeNull();

    // fail f6: three failures all session, but the last five hold two.
    await attempt(false);
    expect(screen.queryByText(/Difficulty eased/)).toBeNull();

    // No easing, so the deal order serves g7 next, not the cheapest h8.
    await attempt(true);
    expect(record).toHaveBeenNthCalledWith(7, {
      puzzleId: dealt[6]!.id,
      kind: 'motif',
      group: 'endgame-rook',
      solved: true,
    });
  });

  test('three failures inside the last five ease the session easiest-rating-first', async () => {
    const record = renderSession();

    // fail a1, fail b2, solve c3, solve d4, fail e5: three in the window.
    await attempt(false);
    await attempt(false);
    await attempt(true);
    await attempt(true);
    await attempt(false);

    expect(screen.getByText(/Difficulty eased/)).toBeVisible();

    // The undealt tail reorders easiest first: h8 (1500), then f6 (1550),
    // then g7 (1600), against the deal's order.
    await attempt(false);
    await attempt(true);
    await attempt(true);
    expect(record).toHaveBeenNthCalledWith(6, {
      puzzleId: dealt[7]!.id,
      kind: 'motif',
      group: 'endgame-rook',
      solved: false,
    });
    expect(record).toHaveBeenNthCalledWith(7, {
      puzzleId: dealt[5]!.id,
      kind: 'motif',
      group: 'endgame-rook',
      solved: true,
    });
    expect(record).toHaveBeenNthCalledWith(8, {
      puzzleId: dealt[6]!.id,
      kind: 'motif',
      group: 'endgame-rook',
      solved: true,
    });

    // Eight attempts, eight record calls, each byte-identical to its
    // pre-ST-157 shape: no eased flag, no confidence on the reveal path.
    expect(record).toHaveBeenCalledTimes(8);
  });

  test('the easing is one-way: recovery never re-hardens the set', async () => {
    const record = renderSession();

    // Trigger, then fail the easiest, then three straight solves: the
    // player's accuracy has recovered.
    await attempt(false);
    await attempt(false);
    await attempt(true);
    await attempt(true);
    await attempt(false);
    await attempt(true);
    await attempt(true);
    await attempt(true);

    expect(screen.getByText(/Difficulty eased/)).toBeVisible();

    // The met puzzles keep their rotation: a1 comes back before e5, the
    // easiest of the met ones, so nothing re-sorted by rating.
    await attempt(false);
    expect(record).toHaveBeenNthCalledWith(9, {
      puzzleId: dealt[0]!.id,
      kind: 'motif',
      group: 'endgame-rook',
      solved: false,
    });
  });
});

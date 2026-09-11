/**
 * ST-156. The confidence prompt's placement pins: the question arrives after
 * the outcome settles - a solve - and before any reveal, the skip records
 * absent, an answer rides onDone, and the third-miss reveal path never offers
 * the question.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PracticePuzzle } from '../api/diagnosis-api.ts';
import { DrillCard } from './practice-route.tsx';

const MOVE_PAUSE_MS = 600;
const ROTATE_PAUSE_MS = 1200;

/**
 * A one-solution puzzle: the setup move (g8f6) plays itself, then white's
 * Qxf7 (h5f7) is the only move the player must find - the scholar's-mate
 * shape, legal in this FEN.
 */
function puzzleFixture(): PracticePuzzle {
  return {
    id: '00000000-0000-4000-8000-0000000000f1',
    fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3',
    moves: 'g8f6 h5f7',
    rating: 1500,
  };
}

function square(name: string): HTMLElement {
  const el = document.querySelector(`[data-square="${name}"]`);
  if (el === null) throw new Error(`no square ${name}`);
  return el as HTMLElement;
}

function playMove(from: string, to: string): void {
  fireEvent.click(square(from));
  fireEvent.click(square(to));
}

describe('DrillCard ST-156 confidence prompt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderCard(puzzle: PracticePuzzle = puzzleFixture()) {
    const onDone = vi.fn();
    const view = render(<DrillCard puzzle={puzzle} onDone={onDone} />);
    return { onDone, unmount: view.unmount };
  }

  test('a solve asks the confidence question before reporting, before any reveal', async () => {
    const { onDone } = renderCard();

    // The setup move plays.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MOVE_PAUSE_MS + 50);
    });
    playMove('h5', 'f7');

    // The solve verdict shows; nothing has been reported yet.
    expect(screen.getByText('Solved.')).toBeVisible();
    expect(onDone).not.toHaveBeenCalled();

    // The prompt arrives; the reveal copy never shows first.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MOVE_PAUSE_MS + 50);
    });
    expect(screen.getByText('How sure were you?')).toBeVisible();
    expect(screen.queryByText('The solution.')).toBeNull();
    expect(onDone).not.toHaveBeenCalled();

    // An answer closes the drill.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Sure' }));
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(true, 'sure');
  });

  test('the skip records absent and still reports the solve', async () => {
    const { onDone } = renderCard();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MOVE_PAUSE_MS + 50);
    });
    playMove('h5', 'f7');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MOVE_PAUSE_MS + 50);
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(true, null);
  });

  test('a third miss never offers the question: the reveal reports without confidence', async () => {
    const { onDone } = renderCard();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MOVE_PAUSE_MS + 50);
    });

    // Three legal-but-wrong queen moves burn the pips without committing.
    playMove('h5', 'h6');
    playMove('h5', 'g6');
    playMove('h5', 'h4');

    expect(screen.getByText('The solution.')).toBeVisible();
    expect(screen.queryByText('How sure were you?')).toBeNull();

    // The reveal plays the solution, then reports with no confidence.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * MOVE_PAUSE_MS + ROTATE_PAUSE_MS + 50);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROTATE_PAUSE_MS + 50);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(false, null);
  });

  test('each of the three answers rides onDone with its value', async () => {
    for (const answer of ['not_sure', 'guessed'] as const) {
      const { onDone, unmount } = renderCard();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MOVE_PAUSE_MS + 50);
      });
      playMove('h5', 'f7');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MOVE_PAUSE_MS + 50);
      });
      act(() => {
        fireEvent.click(
          screen.getByRole('button', { name: answer === 'not_sure' ? 'Was not sure' : 'Guessed' }),
        );
      });
      expect(onDone).toHaveBeenCalledWith(true, answer);
      unmount();
    }
  });
});

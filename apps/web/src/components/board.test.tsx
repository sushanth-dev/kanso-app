import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi, type Mock } from 'vitest';
import { Board, describePosition } from './board.tsx';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

let restoreAnimate: (() => void) | null = null;

afterEach(() => {
  restoreAnimate?.();
  restoreAnimate = null;
});

/**
 * jsdom has no Web Animations API and exposes no SVGGElement global, so the
 * stub lands on the constructor of a piece actually on the board.
 */
function stubPieceAnimate(container: HTMLElement): Mock {
  const piece = container.querySelector('g');
  if (piece === null) throw new Error('no piece to stub');
  const prototype = (piece.constructor as unknown as { prototype: { animate?: unknown } })
    .prototype;
  const previous = Object.getOwnPropertyDescriptor(prototype, 'animate');
  const animate = vi.fn(() => ({ cancel() {}, onfinish: null, oncancel: null }));
  Object.defineProperty(prototype, 'animate', {
    writable: true,
    configurable: true,
    value: animate,
  });
  restoreAnimate = () => {
    if (previous === undefined) delete prototype.animate;
    else Object.defineProperty(prototype, 'animate', previous);
  };
  return animate;
}

describe('Board', () => {
  test('renders the pieces from a FEN position', () => {
    render(<Board fen={START} label="Start position" />);
    expect(screen.getByRole('img', { name: 'Start position' })).toBeInTheDocument();
    // 32 pieces, each side with its own colour label.
    expect(screen.getAllByRole('img', { name: 'white king' })).toHaveLength(1);
    expect(screen.getAllByRole('img', { name: 'black king' })).toHaveLength(1);
    expect(screen.getAllByRole('img', { name: 'white pawn' })).toHaveLength(8);
    expect(screen.getAllByRole('img', { name: 'black pawn' })).toHaveLength(8);
    expect(screen.getAllByRole('img', { name: 'white rook' })).toHaveLength(2);
    expect(screen.getAllByRole('img', { name: 'black rook' })).toHaveLength(2);
  });

  test('marks the from and to squares in gold', () => {
    const { container } = render(<Board fen={START} from="e2" to="e4" label="Mistake move" />);
    const squares = Array.from(container.querySelectorAll('rect'));
    const highlighted = squares.filter((rect) => rect.getAttribute('fill') === '#e9b44c');
    expect(highlighted).toHaveLength(2);
  });

  test('a sparse FEN renders only the pieces it names', () => {
    render(<Board fen="8/8/8/8/8/8/8/K7 w - - 0 1" label="Lone king" />);
    expect(screen.getAllByRole('img', { name: 'white king' })).toHaveLength(1);
  });

  test('draws the best-move arrow from bestFrom to bestTo', () => {
    const { container } = render(<Board fen={START} bestFrom="e2" bestTo="e4" label="Best move" />);
    expect(container.querySelectorAll('line')).toHaveLength(1);
    expect(container.querySelector('polygon')).not.toBeNull();
  });

  test('a position change slides the moved piece from its old square to its new one', () => {
    const after = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const { container, rerender } = render(<Board fen={START} label="Review" />);
    const animate = stubPieceAnimate(container);
    rerender(<Board fen={after} label="Review" />);
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames, options] = animate.mock.calls[0]! as [
      Array<{ transform: string }>,
      { duration: number },
    ];
    // e2 sits at viewBox origin (5, 7); e4 at (5, 5) - row runs 7 - rank.
    expect(frames[0]!.transform).toBe('translate(5px, 7px) scale(0.0222)');
    expect(frames[1]!.transform).toBe('translate(5px, 5px) scale(0.0222)');
    expect(options.duration).toBe(200);
  });

  test('castling slides both the king and the rook', () => {
    const before = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    const after = 'r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1';
    const { container, rerender } = render(<Board fen={before} label="Review" />);
    const animate = stubPieceAnimate(container);
    rerender(<Board fen={after} label="Review" />);
    expect(animate).toHaveBeenCalledTimes(2);
    const origins = animate.mock.calls.map(
      (call) => (call[0] as Array<{ transform: string }>)[0]!.transform,
    );
    // King e1 (5, 8) to g1 (7, 8); the kingside rook h1 (8, 8) to f1 (6, 8).
    expect(origins).toContain('translate(5px, 8px) scale(0.0222)');
    expect(origins).toContain('translate(8px, 8px) scale(0.0222)');
  });

  test('reduced motion renders the new position with no slide', () => {
    const after = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const { container, rerender } = render(<Board fen={START} label="Review" />);
    const animate = stubPieceAnimate(container);
    const original = window.matchMedia.bind(window);
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({ ...original(query), matches: query.includes('reduce') }),
    });
    try {
      rerender(<Board fen={after} label="Review" />);
      expect(animate).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'matchMedia', { writable: true, value: original });
    }
  });

  test('describePosition names the pieces by colour and square', () => {
    expect(describePosition(START)).toBe(
      'white king e1, queen d1, rooks a1 h1, bishops c1 f1, knights b1 g1, pawns a2 b2 c2 d2 e2 f2 g2 h2. black king e8, queen d8, rooks a8 h8, bishops c8 f8, knights b8 g8, pawns a7 b7 c7 d7 e7 f7 g7 h7.',
    );
  });
});

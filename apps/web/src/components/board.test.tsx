import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { Board, describePosition } from './board.tsx';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('Board', () => {
  test('renders the pieces from a FEN position', () => {
    render(<Board fen={START} label="Start position" />);
    expect(screen.getByRole('img', { name: 'Start position' })).toBeInTheDocument();
    // One king each, eight pawns each, two rooks each.
    expect(screen.getAllByText('\u2654')).toHaveLength(1);
    expect(screen.getAllByText('\u265A')).toHaveLength(1);
    expect(screen.getAllByText('\u2659')).toHaveLength(8);
    expect(screen.getAllByText('\u265F')).toHaveLength(8);
    expect(screen.getAllByText('\u2656')).toHaveLength(2);
  });

  test('marks the from and to squares in gold', () => {
    const { container } = render(<Board fen={START} from="e2" to="e4" label="Mistake move" />);
    const squares = Array.from(container.querySelectorAll('rect'));
    const highlighted = squares.filter((rect) => rect.getAttribute('fill') === '#e9b44c');
    expect(highlighted).toHaveLength(2);
  });

  test('a sparse FEN renders only the pieces it names', () => {
    render(<Board fen="8/8/8/8/8/8/8/K7 w - - 0 1" label="Lone king" />);
    expect(screen.getAllByText('\u2654')).toHaveLength(1);
    expect(screen.queryAllByText('\u265A')).toHaveLength(0);
  });
  test('draws the best-move arrow from bestFrom to bestTo', () => {
    const { container } = render(<Board fen={START} bestFrom="e2" bestTo="e4" label="Best move" />);
    expect(container.querySelectorAll('line')).toHaveLength(1);
    expect(container.querySelector('polygon')).not.toBeNull();
  });

  test('describePosition names the pieces by colour and square', () => {
    expect(describePosition(START)).toBe(
      'white king e1, queen d1, rooks a1 h1, bishops c1 f1, knights b1 g1, pawns a2 b2 c2 d2 e2 f2 g2 h2. black king e8, queen d8, rooks a8 h8, bishops c8 f8, knights b8 g8, pawns a7 b7 c7 d7 e7 f7 g7 h7.',
    );
  });
});

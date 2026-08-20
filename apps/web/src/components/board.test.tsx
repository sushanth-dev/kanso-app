import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { Board } from './board.tsx';

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
});

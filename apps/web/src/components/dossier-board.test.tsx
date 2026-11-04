import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DossierBoard } from './dossier-board.tsx';

describe('DossierBoard', () => {
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  test('renders static SVG board with label and coordinate markings', () => {
    const { container } = render(
      <DossierBoard
        fen={START_FEN}
        label="Test board position"
        title="Round 1 decisive position"
      />,
    );

    const svg = screen.getByRole('region', { name: 'Test board position' });
    expect(svg).toBeVisible();

    // Verify coordinate letters and numbers
    expect(screen.getByText('Round 1 decisive position')).toBeVisible();
    expect(container.querySelectorAll('.dossier-coord')).toHaveLength(16); // 8 ranks + 8 files
  });

  test('renders piece elements and best-move arrow', () => {
    const { container } = render(
      <DossierBoard
        fen="4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"
        label="Endgame king position"
        bestFrom="e2"
        bestTo="e4"
        movePlayed="e3"
        bestMove="e4"
        motif="Pawn break"
      />,
    );

    // Verify move played, best move, and motif caption
    expect(screen.getByText('e3')).toBeVisible();
    expect(screen.getByText('e4')).toBeVisible();
    expect(screen.getByText('Pawn break')).toBeVisible();

    // Verify best move arrow exists
    expect(container.querySelector('line')).not.toBeNull();
    expect(container.querySelector('polygon')).not.toBeNull();
  });
});

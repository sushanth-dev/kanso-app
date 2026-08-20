import type { ReactNode } from 'react';

const PIECE_GLYPHS: Record<string, string> = {
  K: '\u2654',
  Q: '\u2655',
  R: '\u2656',
  B: '\u2657',
  N: '\u2658',
  P: '\u2659',
  k: '\u265A',
  q: '\u265B',
  r: '\u265C',
  b: '\u265D',
  n: '\u265E',
  p: '\u265F',
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

// Board themes from DESIGN.md. The board is the brightest object on the screen.
const BOARD_COLORS = {
  wood: { light: '#ead9b7', dark: '#8f5e38' },
  tournament: { light: '#ebecd0', dark: '#587a41' },
} as const;

export type BoardTheme = keyof typeof BOARD_COLORS;

export interface BoardProps {
  fen: string;
  /** The square the mistake move left from, e.g. "e2". */
  from?: string;
  /** The square the mistake move went to, e.g. "e4". */
  to?: string;
  /** Orient the board from Black's perspective. */
  flipped?: boolean;
  theme?: BoardTheme;
  label: string;
}

interface PlacedPiece {
  file: number;
  rank: number;
  glyph: string;
}

function placedPieces(fen: string): PlacedPiece[] {
  const board = fen.split(' ')[0] ?? '';
  const pieces: PlacedPiece[] = [];
  const ranks = board.split('/');
  for (let rankIndex = 0; rankIndex < ranks.length; rankIndex++) {
    const row = ranks[rankIndex] ?? '';
    let file = 0;
    for (const char of row) {
      if (char >= '1' && char <= '8') {
        file += char.charCodeAt(0) - 48;
        continue;
      }
      pieces.push({ file, rank: 7 - rankIndex, glyph: PIECE_GLYPHS[char] ?? '' });
      file += 1;
    }
  }
  return pieces;
}

export function Board({ fen, from, to, flipped = false, theme = 'wood', label }: BoardProps) {
  const pieces = placedPieces(fen);
  const colors = BOARD_COLORS[theme];
  const cells: ReactNode[] = [];

  for (let column = 0; column < 8; column++) {
    for (let row = 0; row < 8; row++) {
      const file = flipped ? 7 - column : column;
      const rank = flipped ? row : 7 - row;
      const squareName = `${FILES[file]}${rank + 1}`;
      const highlighted = squareName === from || squareName === to;
      const dark = (file + rank) % 2 === 0;
      cells.push(
        <rect
          key={squareName}
          x={1 + column}
          y={1 + row}
          width={1}
          height={1}
          fill={highlighted ? '#e9b44c' : dark ? colors.dark : colors.light}
          stroke={highlighted ? '#241d16' : 'none'}
          strokeWidth={highlighted ? 0.06 : 0}
        />,
      );
    }
  }

  for (const piece of pieces) {
    if (piece.glyph === '') continue;
    const column = flipped ? 7 - piece.file : piece.file;
    const row = flipped ? piece.rank : 7 - piece.rank;
    const white = piece.glyph === piece.glyph.toUpperCase();
    cells.push(
      <text
        key={`piece-${piece.file}-${piece.rank}`}
        x={1 + column + 0.5}
        y={1 + row + 0.5}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={0.8}
        fill={white ? '#fffdf8' : '#241d16'}
        stroke={white ? '#241d16' : '#fffdf8'}
        strokeWidth={0.035}
        paintOrder="stroke"
        style={{ fontFamily: '"Segoe UI Symbol", "Noto Sans Symbols 2", sans-serif' }}
      >
        {piece.glyph}
      </text>,
    );
  }

  for (let column = 0; column < 8; column++) {
    const file = flipped ? 7 - column : column;
    cells.push(
      <text
        key={`file-${column}`}
        x={1 + column + 0.5}
        y={9.6}
        textAnchor="middle"
        fontSize={0.34}
        fill="#584e42"
      >
        {FILES[file]}
      </text>,
    );
  }
  for (let row = 0; row < 8; row++) {
    const rank = flipped ? row : 7 - row;
    cells.push(
      <text
        key={`rank-${row}`}
        x={0.45}
        y={1 + row + 0.5}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={0.34}
        fill="#584e42"
      >
        {rank + 1}
      </text>,
    );
  }

  return (
    <svg viewBox="0 0 10 10" role="img" aria-label={label} className="block w-full">
      {cells}
    </svg>
  );
}

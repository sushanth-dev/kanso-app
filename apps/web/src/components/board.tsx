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

const PIECE_NAMES: Record<string, string> = {
  K: 'king',
  Q: 'queen',
  R: 'rook',
  B: 'bishop',
  N: 'knight',
  P: 'pawn',
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
  /** The square the engine's best move left from; draws an arrow to `bestTo`. */
  bestFrom?: string;
  /** The square the engine's best move went to; the arrowhead lands here. */
  bestTo?: string;
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

/** The viewBox centre of a square name like "e2", respecting the flip. */
function squareCenter(square: string, flipped: boolean): { x: number; y: number } {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const column = flipped ? 7 - file : file;
  const row = flipped ? rank : 7 - rank;
  return { x: 1 + column + 0.5, y: 1 + row + 0.5 };
}

/**
 * A screen-reader reading of a FEN position: the pieces by colour and square,
 * e.g. "white king e1, pawns a2 b2. black king e8.". Reconstructs the position
 * the board draws rather than leaving a screen reader with a bare image label.
 */
export function describePosition(fen: string): string {
  const board = fen.split(' ')[0] ?? '';
  const white: Record<string, string[]> = {};
  const black: Record<string, string[]> = {};
  const ranks = board.split('/');
  for (let rankIndex = 0; rankIndex < ranks.length; rankIndex++) {
    const row = ranks[rankIndex] ?? '';
    let file = 0;
    for (const char of row) {
      if (char >= '1' && char <= '8') {
        file += char.charCodeAt(0) - 48;
        continue;
      }
      const name = PIECE_NAMES[char.toUpperCase()];
      if (name !== undefined) {
        const side = char === char.toUpperCase() ? white : black;
        (side[name] ??= []).push(`${FILES[file]}${8 - rankIndex}`);
      }
      file += 1;
    }
  }

  const describeSide = (side: Record<string, string[]>, label: string): string => {
    const parts: string[] = [];
    for (const name of ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn']) {
      const squares = side[name];
      if (squares === undefined || squares.length === 0) continue;
      parts.push(`${name}${squares.length > 1 ? 's' : ''} ${squares.join(' ')}`);
    }
    return parts.length === 0 ? '' : `${label} ${parts.join(', ')}`;
  };

  return (
    [describeSide(white, 'white'), describeSide(black, 'black')].filter(Boolean).join('. ') + '.'
  );
}

export function Board({
  fen,
  from,
  to,
  bestFrom,
  bestTo,
  flipped = false,
  theme = 'wood',
  label,
}: BoardProps) {
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
  if (bestFrom !== undefined && bestTo !== undefined) {
    const start = squareCenter(bestFrom, flipped);
    const end = squareCenter(bestTo, flipped);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const ux = dx / length;
    const uy = dy / length;
    // Stop the shaft short of the centre so the arrowhead sits at the edge.
    const tipX = end.x - ux * 0.24;
    const tipY = end.y - uy * 0.24;
    const head = 0.2;
    const baseX = tipX - ux * head * 1.3;
    const baseY = tipY - uy * head * 1.3;
    const nx = -uy;
    const ny = ux;
    cells.push(
      <g key="best-move-arrow">
        <line
          x1={start.x}
          y1={start.y}
          x2={tipX}
          y2={tipY}
          stroke="#2e7d32"
          strokeWidth={0.14}
          strokeLinecap="round"
          opacity={0.85}
        />
        <polygon
          points={`${tipX},${tipY} ${baseX + nx * head},${baseY + ny * head} ${baseX - nx * head},${baseY - ny * head}`}
          fill="#2e7d32"
          opacity={0.85}
        />
      </g>,
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

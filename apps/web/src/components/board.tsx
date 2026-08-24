import type { ReactNode } from 'react';

// The cburnett piece set (the standard used by lichess/chess.com). Each piece
// is one path; white and black differ only in fill/stroke, so the shape is
// defined once and recoloured per side. Far easier to tell apart than Unicode
// glyphs at board size.
const PIECE_PATHS: Record<string, string> = {
  K: 'M22.5 11.63V6M20 8h5M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5M12.5 37c5.5 3.5 14.5 3.5 20 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-2.5-7.5-12-10.5-16-4-3 6 6 10.5 6 10.5v7M12.5 30c5.5-3 14.5-3 20 0m-20 3.5c5.5-3 14.5-3 20 0m-20 3.5c5.5-3 14.5-3 20 0',
  Q: 'M9 26C17.5 24.5 30 24.5 36 26L38.5 13.5 31 25 30.7 10.9 25.5 24.5 22.5 10 19.5 24.5 14.3 10.9 14 25 6.5 13.5 9 26zM9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1 2.5-1 2.5-1.5 1.5 0 2.5 0 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0zM11.5 30C15 29 30 29 33.5 30M12 33.5C18 32.5 27 32.5 33 33.5M4 12a2 2 0 1 1 4 0 2 2 0 1 1-4 0M12 9a2 2 0 1 1 4 0 2 2 0 1 1-4 0M20.5 8a2 2 0 1 1 4 0 2 2 0 1 1-4 0M29 9a2 2 0 1 1 4 0 2 2 0 1 1-4 0M37 12a2 2 0 1 1 4 0 2 2 0 1 1-4 0',
  R: 'M9 39h27v-3H9v3zM12 36v-4h21v4H12zM11 14V9h4v2h5V9h5v2h5V9h4v5M11 14h23l-3 14H14l-3-14zM12 17.5l3.5 3.5M14 15l3.5 3.5M12 21.5l3.5 3.5M14 19l3.5 3.5M20 17.5l3.5 3.5M22 15l3.5 3.5M20 21.5l3.5 3.5M22 19l3.5 3.5M28 17.5l3.5 3.5M30 15l3.5 3.5M28 21.5l3.5 3.5M30 19l3.5 3.5',
  B: 'M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.35.49-2.32.47-3-.5 1.35-1.46 3-2 3-2zM15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2zM25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0zM17.5 26h10M15 30h15M22.5 15.5v5M20 18h5',
  N: 'M22 10C32.5 11 38.5 18 38 39H15c0-9 10-11.5 8-21M24 18c.38 2.91-5.55 7.37-8 9-3 2-3.18 4.34-5 4-1.04-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4.003 1-4-6 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 .5-1 2.5 2.5 2.5 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0M15 15.5a.5 1.5 0 1 1-1 0 .5 1.5 0 1 1 1 0',
  P: 'm22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03C15.41 27.09 11 31.58 11 39.5h23C34 31.58 29.59 27.09 26.59 26.03 28.06 24.84 29 23.03 29 21c0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z',
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
  type: string;
  white: boolean;
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
      pieces.push({
        file,
        rank: 7 - rankIndex,
        type: char.toUpperCase(),
        white: char === char.toUpperCase(),
      });
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
    const path = PIECE_PATHS[piece.type];
    if (path === undefined) continue;
    const column = flipped ? 7 - piece.file : piece.file;
    const row = flipped ? piece.rank : 7 - piece.rank;
    // The cburnett paths are drawn on a 45x45 grid; scale to the square and
    // centre it. White pieces fill light with a dark outline, black the reverse.
    const fill = piece.white ? '#fffdf8' : '#241d16';
    const stroke = piece.white ? '#241d16' : '#fffdf8';
    cells.push(
      <g
        key={`piece-${piece.file}-${piece.rank}`}
        transform={`translate(${1 + column}, ${1 + row}) scale(0.0222)`}
        role="img"
        aria-label={`${piece.white ? 'white' : 'black'} ${PIECE_NAMES[piece.type]}`}
      >
        <path d={path} fill={fill} stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" />
      </g>,
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

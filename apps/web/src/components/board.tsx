import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

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
  /** ST-101. The square the practice player picked; drawn as an ink line over a paper ring. */
  selectedSquare?: string;
  /** ST-101. The picked piece's legal destinations; drawn as hint dots (ink with a paper ring). */
  targetSquares?: string[];
  /** ST-101. The squares whose pieces may be picked up and dragged; absent, pieces stay put. */
  draggableSquares?: string[];
  /** ST-101. Click or drop on a square; absent, the board stays display-only. */
  onSquareClick?: (square: string) => void;
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

/** The viewBox top-left corner of a square, respecting the flip. */
function squareOrigin(square: string, flipped: boolean): { x: number; y: number } {
  const centre = squareCenter(square, flipped);
  return { x: centre.x - 0.5, y: centre.y - 0.5 };
}

/** The name of the square a piece sits on. */
function squareOf(file: number, rank: number): string {
  return `${FILES[file] ?? ''}${rank + 1}`;
}

/** The viewBox point a pointer event lands on. */
function viewBoxPoint(
  event: ReactPointerEvent,
  svg: SVGSVGElement | null,
): { x: number; y: number } {
  if (svg === null) return { x: 0, y: 0 };
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
  return {
    x: ((event.clientX - rect.left) / rect.width) * 10,
    y: ((event.clientY - rect.top) / rect.height) * 10,
  };
}

/** The square under a viewBox point, or null when the point is off the 8x8 grid. */
function squareFromPoint(x: number, y: number, flipped: boolean): string | null {
  const column = Math.floor(x - 1);
  const row = Math.floor(y - 1);
  if (column < 0 || column > 7 || row < 0 || row > 7) return null;
  const file = flipped ? 7 - column : column;
  const rank = flipped ? row : 7 - row;
  return `${FILES[file] ?? ''}${rank + 1}`;
}

/** ST-101. A piece picked up by a pointer: it follows the pointer until dropped. */
interface DragState {
  square: string;
  /** Pointer position in viewBox units. */
  x: number;
  y: number;
  pointerId: number;
  /** The square under the pointer, or null while off the grid. */
  hover: string | null;
}

/**
 * A dragged piece returning to its square after a drop that moved nothing.
 * The position the drag started from rides along: when the drop committed,
 * the position has moved on and the ride cancels before it paints.
 */
interface SnapbackState {
  type: string;
  white: boolean;
  /** The drop point in viewBox units; the animation starts here. */
  x: number;
  y: number;
  square: string;
  fen: string;
}

/** The viewBox centre of a square name like "e2", respecting the flip. */
function squareCenter(square: string, flipped: boolean): { x: number; y: number } {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const column = flipped ? 7 - file : file;
  const row = flipped ? rank : 7 - rank;
  return { x: 1 + column + 0.5, y: 1 + row + 0.5 };
}

/** A piece that changed squares between the previous position and this one. */
interface MovedPiece {
  type: string;
  white: boolean;
  fromSquare: string;
  toSquare: string;
}

/**
 * The squares pieces moved between two placements, derived by diffing them:
 * the piece of a colour and type that vanished on one square and appeared on
 * another is one move. Leftover disappearance and arrival of a colour pair in
 * order whatever their type - that is a promotion, a pawn gone and a queen
 * new - and a leftover with no partner is a capture, which never animates.
 * Stepping backwards through a game is just another diff: the piece travels
 * the other way.
 */
function movedPieces(before: PlacedPiece[], after: PlacedPiece[]): MovedPiece[] {
  const moves: MovedPiece[] = [];
  for (const white of [true, false]) {
    const gone: string[] = [];
    const fresh: Array<{ type: string; square: string }> = [];
    for (const type of ['P', 'N', 'B', 'R', 'Q', 'K']) {
      const beforeSquares = before
        .filter((piece) => piece.white === white && piece.type === type)
        .map((piece) => squareOf(piece.file, piece.rank));
      const afterSquares = after
        .filter((piece) => piece.white === white && piece.type === type)
        .map((piece) => squareOf(piece.file, piece.rank));
      const arrived = new Set(afterSquares);
      const disappeared: string[] = [];
      for (const square of beforeSquares) {
        if (arrived.has(square)) arrived.delete(square);
        else disappeared.push(square);
      }
      const departed = new Set(beforeSquares);
      const appeared: string[] = [];
      for (const square of afterSquares) {
        if (departed.has(square)) departed.delete(square);
        else appeared.push(square);
      }
      const paired = Math.min(disappeared.length, appeared.length);
      for (let i = 0; i < paired; i++) {
        moves.push({ type, white, fromSquare: disappeared[i]!, toSquare: appeared[i]! });
      }
      for (let i = paired; i < disappeared.length; i++) gone.push(disappeared[i]!);
      for (let i = paired; i < appeared.length; i++) {
        fresh.push({ type, square: appeared[i]! });
      }
    }
    const promoted = Math.min(gone.length, fresh.length);
    for (let i = 0; i < promoted; i++) {
      moves.push({
        type: fresh[i]!.type,
        white,
        fromSquare: gone[i]!,
        toSquare: fresh[i]!.square,
      });
    }
  }
  return moves;
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
  selectedSquare,
  targetSquares,
  draggableSquares,
  onSquareClick,
  flipped = false,
  theme = 'wood',
  label,
}: BoardProps) {
  const pieces = placedPieces(fen);
  const colors = BOARD_COLORS[theme];
  const cells: ReactNode[] = [];
  const interactive = onSquareClick !== undefined;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const mayDrag = (square: string): boolean =>
    draggableSquares !== undefined && draggableSquares.includes(square);

  // Piece movement: the previous position is kept so a fen change can diff
  // the two placements and slide the pieces that changed squares (200ms, the
  // base duration on the standard ease). Elements register by square so the
  // layout effect can reach them after the commit.
  const pieceElsRef = useRef<Map<string, SVGGElement>>(new Map());
  const activeAnimsRef = useRef<WeakMap<SVGGElement, Animation>>(new WeakMap());
  const prevPositionRef = useRef<{ fen: string; pieces: PlacedPiece[] } | null>(null);
  // A drop that lands commits the move with the drag itself as the travel, so
  // the slide is suppressed for exactly that from-to pair for one position
  // change.
  const skipMoveRef = useRef<string | null>(null);
  const snapbackRef = useRef<SVGGElement | null>(null);
  const [snapback, setSnapback] = useState<SnapbackState | null>(null);

  useLayoutEffect(() => {
    const skip = skipMoveRef.current;
    skipMoveRef.current = null;
    const prev = prevPositionRef.current;
    prevPositionRef.current = { fen, pieces };
    if (prev === null || prev.fen === fen) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const move of movedPieces(prev.pieces, pieces)) {
      if (skip !== null && move.fromSquare + move.toSquare === skip) continue;
      const el = pieceElsRef.current.get(move.toSquare);
      if (el === undefined) continue;
      if (typeof el.animate !== 'function') continue; // no WAAPI: positions are already final
      const origin = squareOrigin(move.fromSquare, flipped);
      const destination = squareOrigin(move.toSquare, flipped);
      const active = activeAnimsRef.current.get(el);
      if (active !== undefined) active.cancel();
      // CSS px on an SVG child are user units, so the keyframes speak the
      // same coordinates the transform attribute does.
      const anim = el.animate(
        [
          { transform: `translate(${origin.x}px, ${origin.y}px) scale(0.0222)` },
          { transform: `translate(${destination.x}px, ${destination.y}px) scale(0.0222)` },
        ],
        { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      );
      activeAnimsRef.current.set(el, anim);
    }
  });

  // The snapback ghost rides one animation from the drop point back to its
  // square, then unmounts. When the drop committed, the position has moved
  // on - the drag itself was the travel - and the ride cancels unpainted.
  useLayoutEffect(() => {
    if (snapback === null) return;
    if (snapback.fen !== fen) {
      setSnapback(null);
      return;
    }
    const el = snapbackRef.current;
    if (
      el === null ||
      typeof el.animate !== 'function' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setSnapback(null);
      return;
    }
    const origin = squareOrigin(snapback.square, flipped);
    const anim = el.animate(
      [
        { transform: `translate(${snapback.x - 0.53}px, ${snapback.y - 0.53}px) scale(0.0235)` },
        { transform: `translate(${origin.x}px, ${origin.y}px) scale(0.0222)` },
      ],
      { duration: 120, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    );
    anim.onfinish = () => setSnapback(null);
    anim.oncancel = () => setSnapback(null);
  }, [snapback, fen, flipped]);

  const beginDrag = (event: ReactPointerEvent<SVGGElement>, square: string): void => {
    if (!interactive || !mayDrag(square)) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom has no pointer capture; the click path never drags.
    }
    const point = viewBoxPoint(event, svgRef.current);
    setDrag({ square, x: point.x, y: point.y, pointerId: event.pointerId, hover: square });
    // Picking up the already-selected piece keeps its selection; picking up
    // any other piece selects it, exactly as clicking it would.
    if (selectedSquare !== square) onSquareClick(square);
  };

  const moveDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const point = viewBoxPoint(event, svgRef.current);
    setDrag({ ...drag, x: point.x, y: point.y, hover: squareFromPoint(point.x, point.y, flipped) });
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (!interactive || drag === null) return;
    const point = viewBoxPoint(event, svgRef.current);
    const drop = squareFromPoint(point.x, point.y, flipped);
    setDrag(null);
    // Stage the ride home first: whatever the drop does, the piece leaves the
    // pointer from here. When the move commits, the position has moved on and
    // the ride cancels unpainted - the drag itself was the travel.
    const dragged = pieces.find((piece) => squareOf(piece.file, piece.rank) === drag.square);
    if (dragged !== undefined) {
      setSnapback({
        type: dragged.type,
        white: dragged.white,
        x: point.x,
        y: point.y,
        square: drag.square,
        fen,
      });
    }
    if (drop !== null && drop !== drag.square) {
      // The slide for exactly this from-to pair is suppressed: the drag was
      // the travel. The move effect consumes the skip on the next position.
      skipMoveRef.current = drag.square + drop;
      onSquareClick(drop);
    }
  };

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
          data-square={squareName}
          x={1 + column}
          y={1 + row}
          width={1}
          height={1}
          fill={highlighted ? '#e9b44c' : dark ? colors.dark : colors.light}
          stroke={highlighted ? '#241d16' : 'none'}
          strokeWidth={highlighted ? 0.06 : 0}
          onClick={interactive ? () => onSquareClick(squareName) : undefined}
          style={interactive ? { cursor: 'pointer' } : undefined}
        />,
      );
    }
  }

  if (selectedSquare !== undefined) {
    const origin = squareOrigin(selectedSquare, flipped);
    cells.push(
      <g key="selected-square">
        <rect
          x={origin.x}
          y={origin.y}
          width={1}
          height={1}
          fill="none"
          stroke="#fffdf8"
          strokeWidth={0.12}
        />
        <rect
          x={origin.x}
          y={origin.y}
          width={1}
          height={1}
          fill="none"
          stroke="#241d16"
          strokeWidth={0.05}
        />
      </g>,
    );
  }
  if (drag !== null && drag.hover !== null && drag.hover !== drag.square) {
    // The square the pointer is over while a piece is in hand: the same ring
    // the selection wears, so the drop target reads before the release.
    const origin = squareOrigin(drag.hover, flipped);
    cells.push(
      <g key="drag-hover-square">
        <rect
          x={origin.x}
          y={origin.y}
          width={1}
          height={1}
          fill="none"
          stroke="#fffdf8"
          strokeWidth={0.12}
        />
        <rect
          x={origin.x}
          y={origin.y}
          width={1}
          height={1}
          fill="none"
          stroke="#241d16"
          strokeWidth={0.05}
        />
      </g>,
    );
  }

  for (const piece of pieces) {
    const path = PIECE_PATHS[piece.type];
    if (path === undefined) continue;
    const squareName = squareOf(piece.file, piece.rank);
    if (drag !== null && drag.square === squareName) continue; // drawn last, above the dots
    const column = flipped ? 7 - piece.file : piece.file;
    const row = flipped ? piece.rank : 7 - piece.rank;
    // The cburnett paths are drawn on a 45x45 grid; scale to the square and
    // centre it. White pieces fill light with a dark outline, black the reverse.
    const fill = piece.white ? '#fffdf8' : '#241d16';
    const stroke = piece.white ? '#241d16' : '#fffdf8';
    cells.push(
      <g
        key={`piece-${piece.file}-${piece.rank}`}
        ref={(el) => {
          if (el === null) pieceElsRef.current.delete(squareName);
          else pieceElsRef.current.set(squareName, el);
        }}
        transform={`translate(${1 + column}, ${1 + row}) scale(0.0222)`}
        role="img"
        aria-label={`${piece.white ? 'white' : 'black'} ${PIECE_NAMES[piece.type]}`}
        style={
          interactive && !mayDrag(squareName)
            ? { pointerEvents: 'none' }
            : interactive
              ? { cursor: 'grab' }
              : undefined
        }
        onPointerDown={interactive ? (event) => beginDrag(event, squareName) : undefined}
      >
        <path d={path} fill={fill} stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" />
      </g>,
    );
  }

  if (targetSquares !== undefined && targetSquares.length > 0) {
    cells.push(
      // The dots mark the squares the player is aiming at, so clicks must
      // reach the square underneath - otherwise the best-move click lands on
      // a painted circle with no handler and the attempt never registers.
      <g key="target-dots" style={{ pointerEvents: 'none' }}>
        {[...new Set(targetSquares)].map((square) => {
          const centre = squareCenter(square, flipped);
          return (
            <circle
              key={square}
              cx={centre.x}
              cy={centre.y}
              r={0.15}
              fill="#241d16"
              stroke="#fffdf8"
              strokeWidth={0.06}
            />
          );
        })}
      </g>,
    );
  }
  if (drag !== null) {
    const dragged = pieces.find((piece) => squareOf(piece.file, piece.rank) === drag.square);
    const path = dragged === undefined ? undefined : PIECE_PATHS[dragged.type];
    if (dragged !== undefined && path !== undefined) {
      const fill = dragged.white ? '#fffdf8' : '#241d16';
      const stroke = dragged.white ? '#241d16' : '#fffdf8';
      cells.push(
        <g
          key={`piece-${dragged.file}-${dragged.rank}`}
          transform={`translate(${drag.x - 0.53}, ${drag.y - 0.53}) scale(0.0235)`}
          role="img"
          aria-label={`${dragged.white ? 'white' : 'black'} ${PIECE_NAMES[dragged.type]}`}
          style={{ pointerEvents: 'none', cursor: 'grabbing' }}
        >
          <path d={path} fill={fill} stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" />
        </g>,
      );
    }
  }
  if (snapback !== null) {
    const path = PIECE_PATHS[snapback.type];
    if (path !== undefined) {
      const fill = snapback.white ? '#fffdf8' : '#241d16';
      const stroke = snapback.white ? '#241d16' : '#fffdf8';
      cells.push(
        <g
          ref={snapbackRef}
          key="snapback-ghost"
          transform={`translate(${snapback.x - 0.53}, ${snapback.y - 0.53}) scale(0.0235)`}
          role="img"
          aria-label={`${snapback.white ? 'white' : 'black'} ${PIECE_NAMES[snapback.type]}`}
          style={{ pointerEvents: 'none' }}
        >
          <path d={path} fill={fill} stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" />
        </g>,
      );
    }
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
    <svg
      ref={svgRef}
      viewBox="0 0 10 10"
      role="img"
      aria-label={label}
      className="block w-full"
      style={interactive ? { touchAction: 'none' } : undefined}
      onPointerMove={drag !== null ? moveDrag : undefined}
      onPointerUp={drag !== null ? endDrag : undefined}
      onPointerCancel={drag !== null ? () => setDrag(null) : undefined}
    >
      {cells}
    </svg>
  );
}

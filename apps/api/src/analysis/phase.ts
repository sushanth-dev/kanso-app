/**
 * ST-025. The phase a position belongs to: opening, middlegame, or endgame.
 *
 * The rule is stated here, in one place, because it is a number a coach may
 * argue with, and a boundary constant buried in an aggregation is a defect.
 * The two boundaries use different signals on purpose: the opening/middlegame
 * boundary is a book boundary (a move number), and the middlegame/endgame
 * boundary is a material boundary (a piece count).
 *
 * - Opening: ply at most {@link OPENING_MAX_PLY} (the first ten moves).
 * - Endgame: no queens on the board and total non-pawn material at most
 *   {@link ENDGAME_MAX_NONPAWN_MATERIAL}.
 * - Middlegame: everything else.
 *
 * The function is total: every position lands in exactly one phase. Endgame is
 * checked before opening, because a queenless, low-material position is an
 * endgame however early it is reached.
 */

export type Phase = 'opening' | 'middlegame' | 'endgame';

/** Opening extends through this ply. Ply 20 is the last half-move of move 10. */
export const OPENING_MAX_PLY = 20;

/**
 * Endgame: no queens, and non-pawn material (queen 9, rook 5, bishop 3,
 * knight 3; kings and pawns excluded) at most this many points.
 */
export const ENDGAME_MAX_NONPAWN_MATERIAL = 13;

/** Non-pawn piece values, keyed by lowercase piece letter. Pawns and kings are excluded. */
const MATERIAL_VALUE: Record<string, number> = { q: 9, r: 5, b: 3, n: 3 };

function boardMaterial(fen: string): { material: number; queens: number } {
  // The board is the field before the first space; everything after is turn,
  // castling, en passant, and move counters, none of which matter here.
  const board = fen.split(' ')[0] ?? '';
  let material = 0;
  let queens = 0;
  for (const ch of board) {
    const lower = ch.toLowerCase();
    if (lower === 'q') queens++;
    const value = MATERIAL_VALUE[lower];
    if (value !== undefined) material += value;
  }
  return { material, queens };
}

/** The phase of the position a move was played from. */
export function phaseFor(fen: string, ply: number): Phase {
  const { material, queens } = boardMaterial(fen);
  if (queens === 0 && material <= ENDGAME_MAX_NONPAWN_MATERIAL) return 'endgame';
  if (ply <= OPENING_MAX_PLY) return 'opening';
  return 'middlegame';
}

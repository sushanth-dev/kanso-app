/**
 * ST-179. Tactical motif detection for chess positions.
 *
 * Detects whether a move (such as the engine's best move) executes a specific
 * tactical motif:
 * - `back_rank_mate`: checkmate delivered on rank 1 or 8 against a trapped king
 * - `fork`: simultaneous attack on two or more valuable targets
 * - `pin`: slider attacks an enemy piece aligned with a more valuable piece behind it
 * - `skewer`: slider attacks a high-value piece aligned with a lesser piece behind it
 * - `discovered_attack`: moving piece unmasks an attack from a friendly slider
 * - `trapped_piece`: attacks an enemy piece that has no safe escape squares
 *
 * All geometry is clean-room implemented using standard chess raycasting and
 * `chess.js`, with no AGPL code or third-party taggers.
 */
import { Chess } from 'chess.js';
import type { Color, Move, PieceSymbol, Square } from 'chess.js';

export const TACTICAL_MOTIFS = [
  'back_rank_mate',
  'fork',
  'pin',
  'skewer',
  'discovered_attack',
  'trapped_piece',
] as const;

export type TacticalMotif = (typeof TACTICAL_MOTIFS)[number];

const PIECE_VAL: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 100,
};

type RayDir = readonly [number, number];

const ROOK_DIRS: readonly RayDir[] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

const BISHOP_DIRS: readonly RayDir[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const QUEEN_DIRS: readonly RayDir[] = [...ROOK_DIRS, ...BISHOP_DIRS];

const KNIGHT_OFFSETS: readonly RayDir[] = [
  [1, 2],
  [1, -2],
  [-1, 2],
  [-1, -2],
  [2, 1],
  [2, -1],
  [-2, 1],
  [-2, -1],
];

function squareAt(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${String.fromCharCode(97 + file)}${String.fromCharCode(49 + rank)}` as Square;
}

function dirsFor(piece: PieceSymbol): readonly RayDir[] {
  switch (piece) {
    case 'b':
      return BISHOP_DIRS;
    case 'r':
      return ROOK_DIRS;
    case 'q':
      return QUEEN_DIRS;
    default:
      return [];
  }
}

/**
 * Check whether a checkmate is a classic back-rank mate: delivered on rank 1 or 8
 * by a rook or queen while the opposing king on the same rank is trapped by
 * friendly pawns directly in front of it.
 */
function isBackRankMate(chess: Chess, move: Move): boolean {
  if (!chess.isCheckmate()) return false;
  if (move.piece !== 'r' && move.piece !== 'q') return false;

  const enemyColor: Color = move.color === 'w' ? 'b' : 'w';
  const expectedKingRank = enemyColor === 'b' ? 7 : 0;
  const moverRank = move.to.charCodeAt(1) - 49;

  if (moverRank !== expectedKingRank) return false;

  // Find enemy king square
  let kingSq: Square | null = null;
  for (let f = 0; f < 8; f++) {
    const sq = squareAt(f, expectedKingRank);
    if (sq === null) continue;
    const p = chess.get(sq);
    if (p && p.type === 'k' && p.color === enemyColor) {
      kingSq = sq;
      break;
    }
  }
  if (kingSq === null) return false;

  // The pawn wall sits on rank 6 for Black or rank 1 for White
  const pawnRank = enemyColor === 'b' ? 6 : 1;
  const kf = kingSq.charCodeAt(0) - 97;
  let blockerPawns = 0;
  for (const df of [-1, 0, 1]) {
    const sq = squareAt(kf + df, pawnRank);
    if (sq === null) continue;
    const p = chess.get(sq);
    if (p && p.color === enemyColor && p.type === 'p') {
      blockerPawns++;
    }
  }

  return blockerPawns >= 2;
}

/**
 * Check whether moving a piece unmasks a discovered attack from a friendly slider
 * that was blocked by `move.from` before the move.
 */
function isDiscoveredAttack(before: Chess, after: Chess, move: Move): boolean {
  const fromFile = move.from.charCodeAt(0) - 97;
  const fromRank = move.from.charCodeAt(1) - 49;
  const enemyColor: Color = move.color === 'w' ? 'b' : 'w';

  // For each of the 8 directions around `move.from`, check if there was a friendly
  // slider on one side and an enemy target on the other side.
  for (const [df, dr] of QUEEN_DIRS) {
    let sliderSq: Square | null = null;
    let sliderPiece: PieceSymbol | null = null;
    let step = 1;
    while (true) {
      const sq = squareAt(fromFile - df * step, fromRank - dr * step);
      if (sq === null) break;
      const piece = before.get(sq);
      if (piece) {
        if (piece.color === move.color) {
          const valid =
            piece.type === 'q' ||
            (piece.type === 'r' && (df === 0 || dr === 0)) ||
            (piece.type === 'b' && df !== 0 && dr !== 0);
          if (valid) {
            sliderSq = sq;
            sliderPiece = piece.type;
          }
        }
        break;
      }
      step++;
    }
    if (sliderSq === null || sliderPiece === null) continue;

    step = 1;
    while (true) {
      const sq = squareAt(fromFile + df * step, fromRank + dr * step);
      if (sq === null) break;
      const piece = before.get(sq);
      if (piece) {
        if (piece.color === enemyColor) {
          const targetSq = sq;
          const pieceAfter = after.get(targetSq);
          if (pieceAfter && pieceAfter.color === enemyColor) {
            const isValuable =
              pieceAfter.type === 'k' ||
              PIECE_VAL[pieceAfter.type] >= PIECE_VAL[sliderPiece] ||
              PIECE_VAL[pieceAfter.type] >= 3;
            if (isValuable) {
              let rayClear = true;
              const sf = sliderSq.charCodeAt(0) - 97;
              const sr = sliderSq.charCodeAt(1) - 49;
              const tf = targetSq.charCodeAt(0) - 97;
              const tr = targetSq.charCodeAt(1) - 49;
              const stepF = Math.sign(tf - sf);
              const stepR = Math.sign(tr - sr);
              let currF = sf + stepF;
              let currR = sr + stepR;
              while (currF !== tf || currR !== tr) {
                const midSq = squareAt(currF, currR);
                if (midSq !== null && after.get(midSq)) {
                  rayClear = false;
                  break;
                }
                currF += stepF;
                currR += stepR;
              }
              if (rayClear) return true;
            }
          }
        }
        break;
      }
      step++;
    }
  }
  return false;
}

function checkPinOrSkewer(chess: Chess, move: Move): 'pin' | 'skewer' | null {
  const dirs = dirsFor(move.piece);
  if (dirs.length === 0) return null;

  const toFile = move.to.charCodeAt(0) - 97;
  const toRank = move.to.charCodeAt(1) - 49;
  const enemyColor: Color = move.color === 'w' ? 'b' : 'w';

  for (const [df, dr] of dirs) {
    let firstSq: Square | null = null;
    let firstPiece: { type: PieceSymbol; color: Color } | null = null;
    let secondPiece: { type: PieceSymbol; color: Color } | null = null;

    let step = 1;
    while (true) {
      const sq = squareAt(toFile + df * step, toRank + dr * step);
      if (sq === null) break;
      const p = chess.get(sq);
      if (p) {
        if (firstSq === null) {
          if (p.color !== enemyColor) break;
          firstSq = sq;
          firstPiece = p;
        } else {
          if (p.color !== enemyColor) break;
          secondPiece = p;
          break;
        }
      }
      step++;
    }

    if (firstPiece !== null && secondPiece !== null) {
      const v1 = PIECE_VAL[firstPiece.type];
      const v2 = PIECE_VAL[secondPiece.type];
      if (secondPiece.type === 'k' || v2 > v1) {
        return 'pin';
      }
      if (firstPiece.type === 'k' || v1 > v2) {
        return 'skewer';
      }
    }
  }
  return null;
}

/**
 * Check whether a move attacks two or more distinct valuable enemy targets simultaneously.
 */
function isFork(chess: Chess, move: Move): boolean {
  const enemyColor: Color = move.color === 'w' ? 'b' : 'w';
  const effectivePiece = move.promotion ?? move.piece;
  const moverVal = PIECE_VAL[effectivePiece];
  const attackedTargets = new Set<Square>();

  const toFile = move.to.charCodeAt(0) - 97;
  const toRank = move.to.charCodeAt(1) - 49;

  let kingSq: Square | null = null;
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const sq = squareAt(f, r);
      if (sq === null) continue;
      const p = chess.get(sq);
      if (p && p.color === enemyColor && p.type === 'k') {
        kingSq = sq;
        break;
      }
    }
    if (kingSq !== null) break;
  }

  if (kingSq !== null) {
    const kFile = kingSq.charCodeAt(0) - 97;
    const kRank = kingSq.charCodeAt(1) - 49;
    let moverChecksKing = false;

    if (effectivePiece === 'p') {
      const dr = move.color === 'w' ? 1 : -1;
      moverChecksKing = toRank + dr === kRank && Math.abs(toFile - kFile) === 1;
    } else if (effectivePiece === 'n') {
      moverChecksKing =
        (Math.abs(toFile - kFile) === 1 && Math.abs(toRank - kRank) === 2) ||
        (Math.abs(toFile - kFile) === 2 && Math.abs(toRank - kRank) === 1);
    } else if (effectivePiece !== 'k') {
      const dirs = dirsFor(effectivePiece);
      for (const [df, dr] of dirs) {
        let step = 1;
        while (true) {
          const sq = squareAt(toFile + df * step, toRank + dr * step);
          if (sq === null) break;
          const p = chess.get(sq);
          if (p) {
            if (p.color === enemyColor && p.type === 'k') {
              moverChecksKing = true;
            }
            break;
          }
          step++;
        }
        if (moverChecksKing) break;
      }
    }

    if (moverChecksKing) {
      attackedTargets.add(kingSq);
    }
  }

  if (effectivePiece === 'p') {
    const dr = move.color === 'w' ? 1 : -1;
    for (const df of [-1, 1]) {
      const sq = squareAt(toFile + df, toRank + dr);
      if (sq === null || sq === kingSq) continue;
      const p = chess.get(sq);
      if (p && p.color === enemyColor) {
        attackedTargets.add(sq);
      }
    }
  } else if (effectivePiece === 'n') {
    for (const [df, dr] of KNIGHT_OFFSETS) {
      const sq = squareAt(toFile + df, toRank + dr);
      if (sq === null || sq === kingSq) continue;
      const p = chess.get(sq);
      if (p && p.color === enemyColor) {
        attackedTargets.add(sq);
      }
    }
  } else {
    const dirs = dirsFor(effectivePiece);
    for (const [df, dr] of dirs) {
      let step = 1;
      while (true) {
        const sq = squareAt(toFile + df * step, toRank + dr * step);
        if (sq === null) break;
        const p = chess.get(sq);
        if (p) {
          if (p.color === enemyColor && p.type !== 'k') {
            if (PIECE_VAL[p.type] >= moverVal || PIECE_VAL[p.type] >= 3) {
              attackedTargets.add(sq);
            }
          }
          break;
        }
        step++;
      }
    }
  }

  return attackedTargets.size >= 2;
}

/**
 * Check whether a move attacks an enemy piece (N, B, R, Q) that has 0 safe escape squares.
 */
function isTrappedPiece(chess: Chess, move: Move): boolean {
  if (chess.inCheck()) return false;

  const enemyColor: Color = move.color === 'w' ? 'b' : 'w';
  const toFile = move.to.charCodeAt(0) - 97;
  const toRank = move.to.charCodeAt(1) - 49;
  const effectivePiece = move.promotion ?? move.piece;

  const attackedPieces: Square[] = [];
  if (effectivePiece === 'p') {
    const dr = move.color === 'w' ? 1 : -1;
    for (const df of [-1, 1]) {
      const sq = squareAt(toFile + df, toRank + dr);
      if (sq === null) continue;
      const p = chess.get(sq);
      if (p && p.color === enemyColor && p.type !== 'p' && p.type !== 'k') {
        attackedPieces.push(sq);
      }
    }
  } else if (effectivePiece === 'n') {
    for (const [df, dr] of KNIGHT_OFFSETS) {
      const sq = squareAt(toFile + df, toRank + dr);
      if (sq === null) continue;
      const p = chess.get(sq);
      if (p && p.color === enemyColor && p.type !== 'p' && p.type !== 'k') {
        attackedPieces.push(sq);
      }
    }
  } else {
    const dirs = dirsFor(effectivePiece);
    for (const [df, dr] of dirs) {
      let step = 1;
      while (true) {
        const sq = squareAt(toFile + df * step, toRank + dr * step);
        if (sq === null) break;
        const p = chess.get(sq);
        if (p) {
          if (p.color === enemyColor && p.type !== 'p' && p.type !== 'k') {
            attackedPieces.push(sq);
          }
          break;
        }
        step++;
      }
    }
  }

  for (const sq of attackedPieces) {
    const dests = chess.moves({ square: sq, verbose: true });
    if (dests.length === 0) return true;
  }

  return false;
}

/**
 * Detect which tactical motif the engine's `bestMoveSan` executes on `fen`.
 * Returns null if no specific tactical motif is identified.
 */
export function detectTacticalMotif(fen: string, bestMoveSan: string): TacticalMotif | null {
  let before: Chess;
  try {
    before = new Chess(fen);
  } catch {
    return null;
  }
  let move: Move;
  try {
    move = before.move(bestMoveSan);
  } catch {
    return null;
  }
  if (!move) return null;

  const after = before;

  if (isBackRankMate(after, move)) return 'back_rank_mate';
  if (isFork(after, move)) return 'fork';

  const pinOrSkewer = checkPinOrSkewer(after, move);
  if (pinOrSkewer !== null) return pinOrSkewer;

  const freshBefore = new Chess(fen);
  if (isDiscoveredAttack(freshBefore, after, move)) return 'discovered_attack';
  if (isTrappedPiece(after, move)) return 'trapped_piece';

  return null;
}

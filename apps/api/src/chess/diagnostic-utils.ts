/**
 * diagnostic-utils.ts
 *
 * Provides two core analytical primitives for the Socratic Coach:
 *   1. computeHygiene  — attacker/defender count on the blunder's target square
 *   2. findCCT         — enumerate all Checks, Captures, and Threats from a position
 */

import { Chess } from 'chess.js';
import type { Color } from 'chess.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HygieneResult {
  /** Square the blunder piece lands on */
  targetSquare: string;
  /** Square the blunder piece departs from */
  fromSquare: string;
  /** User's pieces on a direct line to targetSquare */
  attackersDC: number;
  /** User's pieces behind a blocker (x-ray) on targetSquare */
  attackersXC: number;
  /** Enemy's pieces on a direct line to targetSquare */
  defendersDC: number;
  /** Enemy's pieces behind a blocker (x-ray) on targetSquare */
  defendersXC: number;
  /** Total user attackers = DC + XC */
  attackers: number;
  /** Total enemy defenders = DC + XC */
  defenders: number;
}

export type ThreatCategory = 'Checkmate' | 'Material';

export interface CCTMove {
  san: string;
  /** UCI format: e.g. "e2e4" */
  uci: string;
  type: 'Check' | 'Capture' | 'Threat';
  threatCategory?: ThreatCategory;
  /**
   * Engine-Truth: only the move matching bestMoveSan is a "Good Option".
   * Falls back to tactical heuristics if bestMoveSan is not provided.
   */
  isGoodOption: boolean;
  /**
   * Useful = NOT a blunder.
   * True if bestMoveSan matches OR 1-ply lookahead shows the piece is not
   * immediately capturable for free (smallest enemy attacker ≥ piece value).
   */
  isUseful: boolean;
}

export interface CCTResult {
  checks: CCTMove[];
  captures: CCTMove[];
  threats: CCTMove[];
  /** All three categories combined, deduplicated (check > capture > threat priority) */
  all: CCTMove[];
  /** Subset of `all` where isUseful === true */
  usefulCCT: CCTMove[];
}

// ─── Piece Values ─────────────────────────────────────────────────────────────

const PIECE_VALUE: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 100,
};

// ─── Board Geometry ───────────────────────────────────────────────────────────

type BoardPiece = { type: string; color: string } | null;
type Board = BoardPiece[][];

function squareToRC(square: string): [number, number] {
  return [8 - parseInt(square[1]), square.charCodeAt(0) - 97];
}

/**
 * Returns true if the piece at [fromRow, fromCol] geometrically attacks [toRow, toCol].
 * Accounts for sliding-piece ray blocking.
 */
function pieceAttacks(
  board: Board,
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number,
): boolean {
  const piece = board[fromRow][fromCol];
  if (!piece) return false;

  const dr = toRow - fromRow;
  const dc = toCol - fromCol;
  if (dr === 0 && dc === 0) return false;

  switch (piece.type.toLowerCase()) {
    case 'p': {
      const forward = piece.color === 'w' ? -1 : 1;
      return dr === forward && Math.abs(dc) === 1;
    }
    case 'n':
      return (
        (Math.abs(dr) === 2 && Math.abs(dc) === 1) || (Math.abs(dr) === 1 && Math.abs(dc) === 2)
      );
    case 'b': {
      if (Math.abs(dr) !== Math.abs(dc)) return false;
      const sr = Math.sign(dr),
        sc = Math.sign(dc);
      for (let i = 1; i < Math.abs(dr); i++) {
        if (board[fromRow + i * sr][fromCol + i * sc]) return false;
      }
      return true;
    }
    case 'r': {
      if (dr !== 0 && dc !== 0) return false;
      const sr = Math.sign(dr),
        sc = Math.sign(dc);
      const steps = Math.max(Math.abs(dr), Math.abs(dc));
      for (let i = 1; i < steps; i++) {
        if (board[fromRow + i * sr][fromCol + i * sc]) return false;
      }
      return true;
    }
    case 'q': {
      const isDiag = Math.abs(dr) === Math.abs(dc);
      const isStraight = dr === 0 || dc === 0;
      if (!isDiag && !isStraight) return false;
      const sr = Math.sign(dr),
        sc = Math.sign(dc);
      const steps = Math.max(Math.abs(dr), Math.abs(dc));
      for (let i = 1; i < steps; i++) {
        if (board[fromRow + i * sr][fromCol + i * sc]) return false;
      }
      return true;
    }
    case 'k':
      return Math.abs(dr) <= 1 && Math.abs(dc) <= 1;
  }
  return false;
}

/**
 * Count pieces of `attackerColor` that geometrically attack `square` on `board`.
 */
function countAttackersOfSquare(board: Board, square: string, attackerColor: string): number {
  const [tr, tc] = squareToRC(square);
  let count = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && piece.color === attackerColor && pieceAttacks(board, r, c, tr, tc)) {
        count++;
      }
    }
  }
  return count;
}

// ─── 1. Hygiene Check ─────────────────────────────────────────────────────────

interface DCXCResult {
  dc: number;
  xc: number;
}

/**
 * "Square Control" ray-caster — counts Direct-Contact (DC) and X-ray (XC)
 * pieces of `color` that control `square`.
 *
 * Chess Physics x-ray rules (must match the AI system prompt in ai.ts):
 *   ROOKS:   x-ray only through friendly R or Q.
 *   BISHOPS: x-ray through friendly Q or B; also through any Pawn but ≤1 sq beyond it.
 *   QUEENS:  x-ray through friendly Q, R, or B; also through any Pawn but ≤1 sq beyond it.
 *
 * Step A — Sliding rays use scanSliderRay with per-piece canXrayThrough checks.
 * Step B — Knights: always dc, never x-ray.
 * Step C — Pawns: always dc (diagonal capture squares).
 * Step D — King: always dc (8 adjacent squares).
 */
function rayCastDCXC(board: Board, square: string, color: string): DCXCResult {
  const [tr, tc] = squareToRC(square);
  let dc = 0,
    xc = 0;

  const ROOK_DIRS: [number, number][] = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];
  const BISHOP_DIRS: [number, number][] = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  type Piece = NonNullable<BoardPiece>;

  // `canXrayThrough(blocker, xcType, dist)`:
  //   blocker  — the first piece found on the ray (the transparent piece)
  //   xcType   — piece type of the second piece (the x-ray attacker)
  //   dist     — squares between blocker and x-ray attacker (1 = directly adjacent)
  function scanSliderRay(
    dirs: [number, number][],
    canSlide: (t: string) => boolean,
    canXrayThrough: (blocker: Piece, xcType: string, dist: number) => boolean,
  ) {
    for (const [dr, df] of dirs) {
      let r = tr + dr,
        f = tc + df;
      let firstPiece: Piece | null = null;
      let firstStep = 0;
      let step = 0;
      while (r >= 0 && r < 8 && f >= 0 && f < 8) {
        step++;
        const p = board[r][f];
        if (p) {
          if (!firstPiece) {
            if (p.color === color && canSlide(p.type)) dc++;
            firstPiece = p;
            firstStep = step;
          } else {
            const dist = step - firstStep;
            if (p.color === color && canSlide(p.type) && canXrayThrough(firstPiece, p.type, dist)) {
              xc++;
            }
            break;
          }
        }
        r += dr;
        f += df;
      }
    }
  }

  // Rook rays — R and Q are direct attackers.
  // R x-ray: only through friendly R or Q.
  // Q x-ray: through friendly Q, R, or B; or any Pawn (dist===1 only).
  scanSliderRay(
    ROOK_DIRS,
    (t) => t === 'r' || t === 'q',
    (blocker, xcType, dist) => {
      const friendlyRQ = blocker.color === color && (blocker.type === 'r' || blocker.type === 'q');
      if (xcType === 'r') return friendlyRQ;
      if (xcType === 'q') {
        return (
          (blocker.color === color &&
            (blocker.type === 'q' || blocker.type === 'r' || blocker.type === 'b')) ||
          (blocker.type === 'p' && dist === 1)
        );
      }
      return false;
    },
  );

  // Bishop rays — B and Q are direct attackers.
  // B x-ray: through friendly Q or B; or any Pawn (dist===1 only).
  // Q x-ray: through friendly Q, R, or B; or any Pawn (dist===1 only).
  scanSliderRay(
    BISHOP_DIRS,
    (t) => t === 'b' || t === 'q',
    (blocker, xcType, dist) => {
      const friendlyQB = blocker.color === color && (blocker.type === 'q' || blocker.type === 'b');
      const isPawnAdjacent = blocker.type === 'p' && dist === 1;
      if (xcType === 'b') return friendlyQB || isPawnAdjacent;
      if (xcType === 'q') {
        return (
          (blocker.color === color &&
            (blocker.type === 'q' || blocker.type === 'r' || blocker.type === 'b')) ||
          isPawnAdjacent
        );
      }
      return false;
    },
  );

  // Knights — always dc
  for (const [dr, df] of [
    [2, 1],
    [2, -1],
    [-2, 1],
    [-2, -1],
    [1, 2],
    [1, -2],
    [-1, 2],
    [-1, -2],
  ] as [number, number][]) {
    const r = tr + dr,
      f = tc + df;
    if (r >= 0 && r < 8 && f >= 0 && f < 8) {
      const p = board[r][f];
      if (p && p.color === color && p.type === 'n') dc++;
    }
  }

  // Pawns — always dc (diagonal capture origins)
  // White pawn attacks from row+1; black pawn attacks from row-1.
  const pawnRow = color === 'w' ? tr + 1 : tr - 1;
  for (const df of [-1, 1]) {
    const f = tc + df;
    if (pawnRow >= 0 && pawnRow < 8 && f >= 0 && f < 8) {
      const p = board[pawnRow][f];
      if (p && p.color === color && p.type === 'p') dc++;
    }
  }

  // King — always dc
  for (const [dr, df] of [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as [number, number][]) {
    const r = tr + dr,
      f = tc + df;
    if (r >= 0 && r < 8 && f >= 0 && f < 8) {
      const p = board[r][f];
      if (p && p.color === color && p.type === 'k') dc++;
    }
  }

  return { dc, xc };
}

/**
 * Post-generation AI guardrail: verifies a claimed X-ray attack against the
 * same ray-casting engine (`rayCastDCXC`) used for mistake diagnosis, so the
 * AI's prose can't hallucinate an X-ray that the chess physics don't support.
 * Returns false (illegal claim → caller should retry generation) if `color`
 * has zero X-ray attackers of `targetSquare` on `fen`.
 */
export function hasXrayAttacker(fen: string, targetSquare: string, color: Color): boolean {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return false;
  }
  const board = chess.board() as Board;
  const { xc } = rayCastDCXC(board, targetSquare, color);
  return xc > 0;
}

/**
 * Compute attacker and defender counts for the square the blunder piece moves to.
 *
 * **Attacker count** (user's perspective) — user's pieces that back up the square
 *   (i.e. can recapture if enemy takes). Does NOT include the piece on the square.
 *
 * **Defender count** (opponent's perspective) — opponent pieces that can capture
 *   on the square.
 *
 * Both counts use pure ray-casting from the target square on the PRE-MOVE board
 * so that the blunder piece (Queen, King, Pawn — whatever moved) is still visible
 * at its original square and counted as a supporter of targetSquare.
 *
 * @param fen       Position BEFORE the blunder (the position the user faced)
 * @param moveSan   The SAN notation of the blunder move (e.g. "Ne5")
 */
export function computeHygiene(fen: string, moveSan: string): HygieneResult | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }

  // Snapshot the board BEFORE applying the move — this is the "pre-move truth".
  // The moving piece is still at fromSquare, so the ray-caster can detect it
  // as a Direct-Contact attacker of targetSquare (e.g. Queen on a diagonal,
  // King one step away, Pawn on the capture diagonal).
  const preMoveBoard = chess.board() as Board;

  const move = chess.move(moveSan, { strict: false });
  if (!move) return null;

  const targetSquare = move.to;
  const fromSquare = move.from;
  const userColor = move.color;
  const enemyColor = userColor === 'w' ? 'b' : 'w';

  const aDCXC = rayCastDCXC(preMoveBoard, targetSquare, userColor);
  const dDCXC = rayCastDCXC(preMoveBoard, targetSquare, enemyColor);

  return {
    targetSquare,
    fromSquare,
    attackersDC: aDCXC.dc,
    attackersXC: aDCXC.xc,
    defendersDC: dDCXC.dc,
    defendersXC: dDCXC.xc,
    attackers: aDCXC.dc + aDCXC.xc,
    defenders: dDCXC.dc + dDCXC.xc,
  };
}

// ─── 2. Null-Move Threat Detection ───────────────────────────────────────────

/**
 * Build the "null-move" FEN: same board, but swap active color.
 * Clears en passant (null move forfeits en passant rights).
 */
function buildNullMoveFen(fen: string): string {
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-'; // clear en passant
  return parts.join(' ');
}

/**
 * After playing a quiet move from `preFen`, detect whether the move creates a threat.
 * Uses the null-move trick: swap the turn back and enumerate forcing responses.
 *
 * @returns ThreatCategory if this is a genuine threat, or null if it is not
 */
function detectThreatCategory(postMoveFen: string, moverColor: string): ThreatCategory | null {
  const nullFen = buildNullMoveFen(postMoveFen);

  let nullChess: Chess;
  try {
    nullChess = new Chess(nullFen);
  } catch {
    return null;
  }

  const nullMoves = nullChess.moves({ verbose: true });
  if (nullMoves.length === 0) return null;

  const opponentColor = moverColor === 'w' ? 'b' : 'w';
  const board = nullChess.board() as Board;

  // Priority 1 — Checkmate threat
  for (const m of nullMoves) {
    try {
      const c2 = new Chess(nullFen);
      c2.move(m.san);
      if (c2.isCheckmate()) return 'Checkmate';
    } catch {
      // ignore
    }
  }

  // Priority 2 — Any winning trade OR any undefended enemy piece (including pawns)
  // Matches MEMORY.md definition: "quiet move attacking (a) undefended enemy piece
  // OR (b) higher-value enemy piece"
  const hasQualifyingCapture = nullMoves.some((m) => {
    if (!m.captured) return false;
    const capturedVal = PIECE_VALUE[m.captured] ?? 1;
    const capturingVal = PIECE_VALUE[m.piece] ?? 1;
    const netGain = capturedVal - capturingVal;
    if (netGain > 0) return true; // winning trade
    if (netGain === 0 && capturedVal >= 3) return true; // equal trade ≥ minor piece
    // Free capture of any piece, including pawns (no defenders)
    if (capturedVal > 0) {
      const defenders = countAttackersOfSquare(board, m.to, opponentColor);
      return defenders === 0;
    }
    return false;
  });
  if (hasQualifyingCapture) return 'Material';

  // No concrete threat detected — do not classify as a Threat
  return null;
}

// ─── 3. Usefulness Check ──────────────────────────────────────────────────────

/**
 * A CCT move is "Useful" if it is not an outright blunder.
 *
 * Engine truth: if `bestMoveSan` is provided, that move is always useful.
 *
 * Heuristic (1-ply lookahead):
 * - Checkmate moves are always useful.
 * - Winning/even captures (capturedValue ≥ movingPieceValue) are always useful.
 * - Otherwise: the move is useful only if the piece on its landing square cannot
 *   be immediately recaptured by a strictly cheaper enemy piece.
 *   (Equal-value trades are accepted; only clear material losses are filtered.)
 */
function computeIsUseful(fen: string, san: string, bestMoveSan?: string): boolean {
  if (bestMoveSan && san === bestMoveSan) return true;

  try {
    const chess = new Chess(fen);
    const move = chess.move(san, { strict: false });
    if (!move) return true;

    if (move.san.includes('#')) return true; // Checkmate → always useful

    const landingSquare = move.to;
    const movingPieceValue = PIECE_VALUE[move.piece] ?? 1;
    const capturedValue = move.captured ? (PIECE_VALUE[move.captured] ?? 1) : 0;
    const enemyColor = move.color === 'w' ? 'b' : 'w';

    // Winning or even capture → useful regardless of recapture risk
    if (capturedValue > 0 && capturedValue >= movingPieceValue) return true;

    // Check enemy attackers of the landing square using pieceAttacks() directly.
    // This avoids chess.attackers() which can miscount pawns (forward vs diagonal).
    const board = chess.board() as Board;
    const [lr, lc] = squareToRC(landingSquare);
    let minAttackerVal = Infinity;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (!piece || piece.color !== enemyColor) continue;
        if (pieceAttacks(board, r, c, lr, lc)) {
          const val = PIECE_VALUE[piece.type] ?? 1;
          if (val < minAttackerVal) minAttackerVal = val;
        }
      }
    }

    if (minAttackerVal === Infinity) return true; // No enemy attackers — piece is safe

    // Useful if smallest enemy attacker is NOT a cheaper piece
    // (equal-value trades ≥ movingPieceValue are acceptable)
    return minAttackerVal >= movingPieceValue;
  } catch {
    return true;
  }
}

// TODO(DEBT-005): threat detection below is static attacker and defender
// counting, so a threat that takes two moves to see is invisible to it. A
// deeper or engine-backed search is the fix, and it is cheap once the engine is
// running. Tracked on the product backlog in the `delivery` repository.

// ─── 4. CCT Scope ─────────────────────────────────────────────────────────────

/**
 * Extract all legal Checks, Captures, and Threats from `fen`.
 *
 * @param fen          Position to analyze (typically the pre-blunder FEN)
 * @param bestMoveSan  Engine's recommended move (used to set `isGoodOption`)
 */
export function findCCT(fen: string, bestMoveSan?: string): CCTResult {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return { checks: [], captures: [], threats: [], all: [], usefulCCT: [] };
  }

  const legalMoves = chess.moves({ verbose: true });
  const seen = new Set<string>();

  const checks: CCTMove[] = [];
  const captures: CCTMove[] = [];
  const threats: CCTMove[] = [];

  for (const m of legalMoves) {
    const uci = m.from + m.to + (m.promotion ?? '');

    // Determine isGoodOption (engine-truth if bestMoveSan provided, else heuristic)
    let isGoodOption: boolean;
    if (bestMoveSan) {
      isGoodOption = m.san === bestMoveSan;
    } else {
      // Heuristic fallback
      if (m.san.includes('+') || m.san.includes('#')) {
        isGoodOption = true;
      } else if (m.captured) {
        const capturedVal = PIECE_VALUE[m.captured] ?? 1;
        const capturingVal = PIECE_VALUE[m.piece] ?? 1;
        isGoodOption = capturedVal >= capturingVal;
      } else {
        isGoodOption = false;
      }
    }

    // Determine isUseful (1-ply lookahead — move is not an outright blunder)
    const isUseful = computeIsUseful(fen, m.san, bestMoveSan);

    // ── Check ──────────────────────────────────────────────────────────────
    // Checks are always useful by definition — a forcing move worth seeing
    if ((m.san.includes('+') || m.san.includes('#')) && !seen.has(m.san)) {
      seen.add(m.san);
      checks.push({ san: m.san, uci, type: 'Check', isGoodOption, isUseful: true });
      continue;
    }

    // ── Capture ─────────────────────────────────────────────────────────────
    if (m.captured && !seen.has(m.san)) {
      seen.add(m.san);
      captures.push({ san: m.san, uci, type: 'Capture', isGoodOption, isUseful });
      continue;
    }

    // ── Threat (quiet moves only) ────────────────────────────────────────────
    if (!m.captured && !m.san.includes('+') && !m.san.includes('#')) {
      try {
        const c2 = new Chess(fen);
        c2.move(m.san);
        const postFen = c2.fen();
        const threatCat = detectThreatCategory(postFen, m.color);
        if (threatCat && !seen.has(m.san)) {
          seen.add(m.san);
          threats.push({
            san: m.san,
            uci,
            type: 'Threat',
            threatCategory: threatCat,
            isGoodOption,
            isUseful,
          });
        }
      } catch {
        // ignore invalid moves
      }
    }
  }

  // Combined, deduplicated list (checks first, then captures, then threats)
  const all: CCTMove[] = [...checks, ...captures, ...threats];
  const usefulCCT = all.filter((m) => m.isUseful);

  return { checks, captures, threats, all, usefulCCT };
}

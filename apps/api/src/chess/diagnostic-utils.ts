/**
 * diagnostic-utils.ts
 *
 * Provides two core analytical primitives for the Socratic Coach:
 *   1. computeHygiene  — attacker/defender count on the blunder's target square
 *   2. findCCT         — enumerate all Checks, Captures, and Threats from a position
 */

import { Chess } from 'chess.js';
import type { Color } from 'chess.js';
import { Chess as OpsChess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { attacks, between, ray } from 'chessops/attacks';
import { opposite, parseSquare, roleToChar } from 'chessops';
import type { Color as OpsColor, Piece, Role } from 'chessops';

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
 * DC pieces are counted with ChessOps's `attacks` (Hyperbola Quintessence for
 * sliders). XC pieces are the sliders of `color` that attack `square` only
 * through a single transparent blocker, applying the per-piece x-ray rules
 * above.
 */
function rayCastDCXC(pos: OpsChess, square: number, color: OpsColor): DCXCResult {
  const board = pos.board;
  const occ = board.occupied;

  // Direct-Contact attackers: any piece of `color` whose attack set contains
  // `square` on the current occupied squares.
  let dc = 0;
  for (const [sq, piece] of board) {
    if (piece.color === color && attacks(piece, sq, occ).has(square)) dc++;
  }

  // X-ray attackers: a slider of `color` behind exactly one blocker on the
  // line to `square`, where the blocker is transparent for that slider.
  let xc = 0;
  const canXrayThrough = (blocker: Piece, xcType: Role, dist: number): boolean => {
    const friendly = blocker.color === color;
    const isPawnAdjacent = blocker.role === 'pawn' && dist === 1;
    if (xcType === 'rook') return friendly && (blocker.role === 'rook' || blocker.role === 'queen');
    if (xcType === 'bishop')
      return (
        (friendly && (blocker.role === 'queen' || blocker.role === 'bishop')) || isPawnAdjacent
      );
    if (xcType === 'queen') {
      return (
        (friendly &&
          (blocker.role === 'queen' || blocker.role === 'rook' || blocker.role === 'bishop')) ||
        isPawnAdjacent
      );
    }
    return false;
  };

  // For each slider of `color`, walk its rays from `square` outward. The first
  // piece on a ray is the potential blocker; the second is a candidate x-ray
  // attacker. `between` gives the squares strictly between two aligned squares.
  const sliders = board
    .pieces(color, 'rook')
    .union(board.pieces(color, 'bishop'))
    .union(board.pieces(color, 'queen'));
  for (const sq of sliders) {
    const piece = board.get(sq)!;
    if (attacks(piece, sq, occ).has(square)) continue; // already a DC attacker
    if (!ray(square, sq).nonEmpty()) continue; // not aligned
    const blockers = between(square, sq).intersect(occ);
    if (blockers.size() !== 1) continue; // x-ray needs exactly one blocker
    const blockerSq = blockers.first()!;
    const blocker = board.get(blockerSq)!;
    const dist = between(blockerSq, sq).size() + 1;
    if (canXrayThrough(blocker, piece.role, dist)) xc++;
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
  let pos: OpsChess;
  try {
    pos = OpsChess.fromSetup(parseFen(fen).unwrap()).unwrap();
  } catch {
    return false;
  }
  const { xc } = rayCastDCXC(pos, parseSquare(targetSquare)!, color === 'w' ? 'white' : 'black');
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
  const move = chess.move(moveSan, { strict: false });
  if (!move) return null;

  const targetSquare = move.to;
  const fromSquare = move.from;
  const userColor = move.color;

  // ChessOps position of the PRE-MOVE board (the moving piece is still at its
  // original square, so it is counted as a supporter of targetSquare).
  let pos: OpsChess;
  try {
    pos = OpsChess.fromSetup(parseFen(fen).unwrap()).unwrap();
  } catch {
    return null;
  }

  const target = parseSquare(targetSquare);
  const aDCXC = rayCastDCXC(pos, target, userColor === 'w' ? 'white' : 'black');
  const dDCXC = rayCastDCXC(pos, target, userColor === 'w' ? 'black' : 'white');

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

// ─── 2. ChessOps Threat Detection ────────────────────────────────────────────

/**
 * Number of pieces of `color` attacking `square` on `pos`, using ChessOps
 * bitboard attack calculations (Hyperbola Quintessence for sliders).
 */
function countAttackers(pos: OpsChess, square: number, color: OpsColor): number {
  const board = pos.board;
  let n = 0;
  for (const [sq, piece] of board) {
    if (piece.color === color && attacks(piece, sq, board.occupied).has(square)) n++;
  }
  return n;
}

/**
 * Squares of enemy (opposite of `moverColor`) non-king pieces that are hanging:
 * more pieces of `moverColor` attack the square than pieces of the enemy defend it.
 */
function hangingSquares(pos: OpsChess, moverColor: OpsColor): Set<number> {
  const enemy = opposite(moverColor);
  const set = new Set<number>();
  for (const [sq, piece] of pos.board) {
    if (piece.color !== enemy || piece.role === 'king') continue;
    if (countAttackers(pos, sq, moverColor) > countAttackers(pos, sq, enemy)) set.add(sq);
  }
  return set;
}

/**
 * True if `moverColor` has a mate-in-one from `pos`. The null-move trick: the
 * opponent is assumed to pass, so `pos` is replayed with `moverColor` to move.
 */
function hasMateInOne(pos: OpsChess, moverColor: OpsColor): boolean {
  const setup = pos.toSetup();
  setup.turn = moverColor;
  const mover = OpsChess.fromSetup(setup).unwrap();
  for (const [from, toSet] of mover.allDests()) {
    for (const to of toSet) {
      const c = mover.clone();
      // chessops only promotes when the move carries a promotion piece; without
      // one a pawn lands on the backrank and the follow-up fromSetup throws.
      c.play({ from, to, promotion: to < 8 || to >= 56 ? 'queen' : undefined });
      if (c.isCheckmate()) return true;
    }
  }
  return false;
}

/**
 * Detect whether a quiet move from `from` to `to` on `prePos` creates a threat.
 *
 * Plays the move on a clone, then compares the hanging enemy pieces before and
 * after. A move is a Material threat if it makes an enemy non-king piece
 * hanging that was not hanging before (this is what catches a discovered
 * attack or a quiet move that lifts a blocker). A move is a Checkmate threat
 * if the mover then has a mate-in-one. A quiet move that changes nothing
 * about the hanging set is not a threat.
 *
 * @returns ThreatCategory if this is a genuine threat, or null if it is not
 */
function detectThreat(
  prePos: OpsChess,
  from: number,
  to: number,
  moverColor: OpsColor,
): ThreatCategory | null {
  const before = hangingSquares(prePos, moverColor);
  const beforeMate = hasMateInOne(prePos, moverColor);

  const after = prePos.clone();
  after.play({ from, to, promotion: to < 8 || to >= 56 ? 'queen' : undefined });
  if (after.isCheck()) return null; // checks are handled separately

  // Checkmate is the stronger threat; report it before a Material threat.
  if (!beforeMate && hasMateInOne(after, moverColor)) return 'Checkmate';

  const created = [...hangingSquares(after, moverColor)].filter((s) => !before.has(s));
  if (created.length > 0) return 'Material';
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

    // Winning or even capture → useful regardless of recapture risk
    if (capturedValue > 0 && capturedValue >= movingPieceValue) return true;

    // Check enemy attackers of the landing square using ChessOps attack
    // geometry on the post-move board. This avoids chess.attackers() which can
    // miscount pawns (forward vs diagonal).
    let pos: OpsChess | null = null;
    try {
      pos = OpsChess.fromSetup(parseFen(chess.fen()).unwrap()).unwrap();
    } catch {
      return true;
    }
    const enemyOpsColor: OpsColor = move.color === 'w' ? 'black' : 'white';
    const attackers = pos.kingAttackers(
      parseSquare(landingSquare),
      enemyOpsColor,
      pos.board.occupied,
    );
    let minAttackerVal = Infinity;
    for (const sq of attackers) {
      const role = pos.board.getRole(sq)!;
      const val = PIECE_VALUE[roleToChar(role)] ?? 1;
      if (val < minAttackerVal) minAttackerVal = val;
    }

    if (minAttackerVal === Infinity) return true; // No enemy attackers — piece is safe

    // Useful if smallest enemy attacker is NOT a cheaper piece
    // (equal-value trades ≥ movingPieceValue are acceptable)
    return minAttackerVal >= movingPieceValue;
  } catch {
    return true;
  }
}

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

  // ChessOps position for attack-geometry threat detection.
  let pos: OpsChess | null = null;
  try {
    pos = OpsChess.fromSetup(parseFen(fen).unwrap()).unwrap();
  } catch {
    // fall back to no threat detection if ChessOps rejects the position
  }

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
    if (!m.captured && !m.san.includes('+') && !m.san.includes('#') && pos) {
      const from = parseSquare(m.from);
      const to = parseSquare(m.to);
      if (from !== undefined && to !== undefined) {
        const threatCat = detectThreat(pos, from, to, pos.turn);
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
      }
    }
  }

  // Combined, deduplicated list (checks first, then captures, then threats)
  const all: CCTMove[] = [...checks, ...captures, ...threats];
  const usefulCCT = all.filter((m) => m.isUseful);

  return { checks, captures, threats, all, usefulCCT };
}

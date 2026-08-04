import { Chess } from 'chess.js';

// ─── Attack geometry (shared by all three heuristics) ────────────────────────

type BoardType = ReturnType<Chess['board']>;

/**
 * Returns [row, col] pairs for every square a piece at (row, col) geometrically attacks.
 * Sliding pieces stop AT the first blocker (they attack it but not beyond).
 */
function pieceAttacks(board: BoardType, row: number, col: number): [number, number][] {
  const piece = board[row][col];
  if (!piece) return [];

  const hits: [number, number][] = [];
  const { type, color } = piece;
  const ok = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const push = (r: number, c: number) => {
    if (ok(r, c)) hits.push([r, c]);
  };
  const slide = (dr: number, dc: number) => {
    let r = row + dr,
      c = col + dc;
    while (ok(r, c)) {
      hits.push([r, c]);
      if (board[r][c]) break;
      r += dr;
      c += dc;
    }
  };

  switch (type) {
    case 'p': {
      const d = color === 'w' ? -1 : 1;
      push(row + d, col - 1);
      push(row + d, col + 1);
      break;
    }
    case 'n':
      for (const [dr, dc] of [
        [-2, -1],
        [-2, 1],
        [-1, -2],
        [-1, 2],
        [1, -2],
        [1, 2],
        [2, -1],
        [2, 1],
      ] as [number, number][])
        push(row + dr, col + dc);
      break;
    case 'b':
      for (const [dr, dc] of [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ] as [number, number][])
        slide(dr, dc);
      break;
    case 'r':
      for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as [number, number][])
        slide(dr, dc);
      break;
    case 'q':
      for (const [dr, dc] of [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as [number, number][])
        slide(dr, dc);
      break;
    case 'k':
      for (const [dr, dc] of [
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [0, -1],
        [0, 1],
        [1, -1],
        [1, 0],
        [1, 1],
      ] as [number, number][])
        push(row + dr, col + dc);
      break;
  }

  return hits;
}

// ─── Heuristics (Physically Isolated Models — No Normalisation) ───────────────

/**
 * Tension — "Volatility Model".
 *
 * Material Value at Risk: sum the value of every piece currently attacked by
 * an enemy piece (Pawn=10, Minor=30, Rook=50, Queen=90).
 * Plus +20 for every "Contested Square" (attacked by both sides).
 * Tension = (Total Points / 5), capped at 100.
 *
 * Effect: spikes sharply during exchanges, stays low during pure maneuvering.
 */
export function calculateTension(chess: Chess): number {
  const board = chess.board();

  // Build per-color attack maps
  const attacks: Record<'w' | 'b', Set<number>> = { w: new Set(), b: new Set() };
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      for (const [ar, ac] of pieceAttacks(board, r, c)) {
        attacks[p.color].add(ar * 8 + ac);
      }
    }
  }

  // Piece values for "material at risk" scoring
  const PIECE_V: Record<string, number> = { p: 10, n: 30, b: 30, r: 50, q: 90, k: 0 };
  let total = 0;

  // Sum value of every piece attacked by an enemy piece
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || p.type === 'k') continue;
      const enemy: 'w' | 'b' = p.color === 'w' ? 'b' : 'w';
      if (attacks[enemy].has(r * 8 + c)) total += PIECE_V[p.type] ?? 0;
    }
  }

  // Add 20 for every contested square (attacked by both sides)
  for (let sq = 0; sq < 64; sq++) {
    if (attacks['w'].has(sq) && attacks['b'].has(sq)) total += 20;
  }

  return Math.min(100, Math.round(total / 5));
}

/**
 * King Safety — "Mitigation Model".
 *
 * King zone = 3×3 area (9 squares including the king's own square).
 *
 * RawPenalty: sum attacker weights for every enemy piece attacking any king zone square.
 *   — Queen=60, Rook=40, Knight/Bishop=25, Pawn=10.
 *
 * Defender Mitigation: count friendly pieces (excl. king) that either occupy
 *   OR attack into (defend) the king zone.  Each reduces RawPenalty by 15%,
 *   capped at 60% total (king is never perfectly safe under real attack).
 *
 * Safety = 100 − (RawPenalty × (1 − MitigationFactor)).  Clamped [0, 100].
 *
 * Example: Queen (60) attacks king + 2 defenders (30%) → 100 − (60 × 0.70) = 58.
 */
export function calculateKingSafety(chess: Chess, color: 'w' | 'b'): number {
  const board = chess.board();
  const enemyColor = color === 'w' ? 'b' : 'w';

  // Locate the king
  let kingRow = -1,
    kingCol = -1;
  outer: for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === 'k' && p.color === color) {
        kingRow = r;
        kingCol = c;
        break outer;
      }
    }
  }
  if (kingRow === -1) return 0;

  // Build 3×3 king zone (9 squares including king's square)
  const kingZone = new Set<number>();
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = kingRow + dr,
        c = kingCol + dc;
      if (r >= 0 && r < 8 && c >= 0 && c < 8) kingZone.add(r * 8 + c);
    }
  }

  // RawPenalty: sum attacker weights for enemy pieces attacking any king zone square
  const ATTACKER_W: Record<string, number> = { p: 10, n: 25, b: 25, r: 40, q: 60, k: 0 };
  let rawPenalty = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || p.color !== enemyColor) continue;
      const attacksZone = pieceAttacks(board, r, c).some(([ar, ac]) => kingZone.has(ar * 8 + ac));
      if (attacksZone) rawPenalty += ATTACKER_W[p.type] ?? 0;
    }
  }

  // Defenders: friendly pieces (not king) physically inside the zone OR attacking into it
  let defenderCount = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || p.color !== color || p.type === 'k') continue;
      if (kingZone.has(r * 8 + c)) {
        defenderCount++;
      } else {
        const defendsZone = pieceAttacks(board, r, c).some(([ar, ac]) => kingZone.has(ar * 8 + ac));
        if (defendsZone) defenderCount++;
      }
    }
  }
  const mitigationFactor = Math.min(0.6, defenderCount * 0.15);

  return Math.max(0, Math.min(100, Math.round(100 - rawPenalty * (1 - mitigationFactor))));
}

/**
 * Activity — "Weighted Influence Model".
 *
 * Count every unique square on the board attacked by the user's pieces.
 * Square weights: Center (d4/d5/e4/e5) = 5×, Extended Center (c3–f6) = 2×, all others = 1×.
 * Coordination: +10 for every friendly piece defended by another friendly piece.
 * Activity = (Total Points / 2), capped at 100.
 *
 * Effect: Activity stays high during tense middlegames because control of space
 * does not depend on legal-move count (which shrinks when pieces are under fire).
 *
 * Board coords: row0=rank8, row7=rank1.
 *   Center:         d4(row4,col3), d5(row3,col3), e4(row4,col4), e5(row3,col4)
 *   Extended Center: cols 2–5 (c–f), rows 2–5 (rank6–rank3) — the full c3–f6 rectangle.
 */
export function calculateActivity(chess: Chess, color: 'w' | 'b'): number {
  const board = chess.board();

  // Center squares (5×): d4, d5, e4, e5
  const CENTER = new Set<number>([4 * 8 + 3, 3 * 8 + 3, 4 * 8 + 4, 3 * 8 + 4]);

  // Extended center rectangle c3–f6 (cols 2–5, rows 2–5 in array coords)
  const EXTENDED_CENTER = new Set<number>();
  for (let r = 2; r <= 5; r++) {
    for (let c = 2; c <= 5; c++) {
      EXTENDED_CENTER.add(r * 8 + c);
    }
  }

  // Collect all unique squares attacked by the user's pieces
  const friendlyAttackedSquares = new Set<number>();
  const friendlyPieceSquares: number[] = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || p.color !== color) continue;
      friendlyPieceSquares.push(r * 8 + c);
      for (const [ar, ac] of pieceAttacks(board, r, c)) {
        friendlyAttackedSquares.add(ar * 8 + ac);
      }
    }
  }

  // Score each unique attacked square by zone weight
  let points = 0;
  for (const sq of friendlyAttackedSquares) {
    if (CENTER.has(sq)) points += 5;
    else if (EXTENDED_CENTER.has(sq)) points += 2;
    else points += 1;
  }

  // Coordination: +10 per friendly piece defended by another friendly piece
  for (const sq of friendlyPieceSquares) {
    if (friendlyAttackedSquares.has(sq)) points += 10;
  }

  return Math.min(100, Math.round(points / 2));
}

/**
 * Calculate aggregate signature from a game's moves.
 * Samples ~10 key positions throughout the game.
 */
export interface SignatureData {
  tension: number;
  safety: number;
  activity: number;
}

export function calculateGameSignature(pgn: string): SignatureData {
  const chess = new Chess();
  chess.loadPgn(pgn);

  const history = chess.history();
  const sampleInterval = Math.max(2, Math.floor(history.length / 10));

  chess.reset();
  const samples: SignatureData[] = [];

  for (let i = 0; i < history.length; i++) {
    chess.move(history[i]);

    if (i % sampleInterval === 0 || i === history.length - 1) {
      const currentTurn = chess.turn();
      samples.push({
        tension: calculateTension(chess),
        safety: calculateKingSafety(chess, currentTurn),
        activity: calculateActivity(chess, currentTurn),
      });
    }
  }

  if (samples.length === 0) {
    return { tension: 0, safety: 0, activity: 0 };
  }

  return {
    tension: Math.round(samples.reduce((sum, s) => sum + s.tension, 0) / samples.length),
    safety: Math.round(samples.reduce((sum, s) => sum + s.safety, 0) / samples.length),
    activity: Math.round(samples.reduce((sum, s) => sum + s.activity, 0) / samples.length),
  };
}

export interface MoveMetrics {
  moveNumber: number;
  tension: number;
  safety: number;
  activity: number;
}

/**
 * Compute per-move heuristics across a game. Only positions where it is the
 * user's turn are sampled.
 *
 * The prototype had two more functions here, `analyzeFullGame` and
 * `analyzeBatch`, which posted to its Express engine server. Analysis runs on
 * SQS and Lambda for us (ADR-0014), so both were dropped on the way over.
 */
export function analyzeFullGame(fens: string[], userSide: 'white' | 'black'): MoveMetrics[] {
  const userColor: 'w' | 'b' = userSide === 'black' ? 'b' : 'w';
  const results: MoveMetrics[] = [];

  for (let i = 0; i < fens.length; i++) {
    const chess = new Chess(fens[i]);

    // Only process positions where it is the user's turn
    if (chess.turn() !== userColor) continue;

    const fenParts = fens[i].split(' ');
    const moveNumber = parseInt(fenParts[5]) || Math.ceil((i + 1) / 2);

    results.push({
      moveNumber,
      tension: calculateTension(chess),
      safety: calculateKingSafety(chess, userColor),
      activity: calculateActivity(chess, userColor),
    });
  }

  return results;
}

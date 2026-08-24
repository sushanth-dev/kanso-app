/**
 * Replay a PGN into the per-ply rows the review surface renders.
 *
 * Import writes these rows so a pending game can be reviewed before analysis
 * runs; analysis then replaces them with evaluated rows. Both callers share
 * this walk so the ply shape (SAN, UCI, FEN, phase, clock) is defined once.
 *
 * The transform must stay linear, never a regex that revisits its input: the
 * input is attacker-supplied PGN. `mergeAdjacentComments` is the one linear
 * pass that makes chess.js accept provider/study exports that write two
 * comments back to back.
 */
import { Chess } from 'chess.js';
import type { Color } from '../chess/lichess-utils.ts';
import { parseClockMs } from './clock.ts';
import { phaseFor } from './phase.ts';
import type { Phase } from './phase.ts';

export interface WalkedPly {
  ply: number;
  moveNumber: number;
  movingColor: Color;
  san: string;
  uci: string;
  fenBefore: string;
  /** Remaining clock after the move, from `%clk`; null for games without it. */
  clockMs: number | null;
  /** Time spent on the move; null for the first move of each side. */
  moveTimeMs: number | null;
}

export interface Walk {
  plies: WalkedPly[];
  /** The position each ply was played from, plus the position the game ended in. */
  positions: string[];
}

/**
 * Merge adjacent brace comments so chess.js accepts the movetext.
 *
 * chess.js takes one comment after a move and throws on a second immediately
 * after the first (`Expected ... but "{" found`). Provider and study exports
 * write two (`5. b4 { 0.12/0 } { [%cal Gb4b5] }`). Merging the two into one
 * comment keeps both texts, so `%clk` still reaches `getComments()` and then
 * `clockMs`; stripping would make the game parse and silently drop the clock.
 *
 * The pattern is one linear pass with no nesting and no alternation, so it
 * cannot backtrack.
 */
export function mergeAdjacentComments(pgn: string): string {
  return pgn.replace(/\}\s*\{/g, ' ');
}

/**
 * Replay the PGN into plies and the positions they were played from. Throws
 * when the PGN has no moves.
 */
export function walkGame(pgn: string): Walk {
  const chess = new Chess();
  chess.loadPgn(mergeAdjacentComments(pgn));
  const history = chess.history({ verbose: true });
  if (history.length === 0) throw new Error('game has no moves to analyse');

  // `%clk` rides on the position a move reached. chess.js exposes it through
  // `getComments()`, keyed by the after-move FEN, so a ply's remaining clock is
  // the comment attached to that ply's `after` position.
  const clockAfter = new Map<string, number>();
  for (const { fen, comment } of chess.getComments()) {
    const ms = parseClockMs(comment);
    if (ms !== null) clockAfter.set(fen, ms);
  }

  // Time spent on a move is the same side's previous remaining clock minus this
  // one; the first move of each side has no previous clock, so it is null.
  const prevClock: Record<Color, number | null> = { white: null, black: null };

  const plies = history.map((move, index) => {
    // Move number and side to move are read off the FEN rather than counted
    // from one, so a game that starts from a position mid-game still numbers
    // its moves the way a player would say them.
    const fields = move.before.split(' ');
    const movingColor = fields[1] === 'b' ? ('black' as const) : ('white' as const);
    const clockMs = clockAfter.get(move.after) ?? null;
    const previous = prevClock[movingColor];
    const moveTimeMs = clockMs !== null && previous !== null ? previous - clockMs : null;
    if (clockMs !== null) prevClock[movingColor] = clockMs;
    return {
      ply: index + 1,
      moveNumber: Number(fields[5]),
      movingColor,
      san: move.san,
      uci: move.lan,
      fenBefore: move.before,
      clockMs,
      moveTimeMs,
    };
  });

  const final = history[history.length - 1]!.after;
  return { plies, positions: [...plies.map((p) => p.fenBefore), final] };
}

/** The `move_ply` insert rows for a PGN, without evaluation fields. */
export function pliesForImport(
  gameId: string,
  pgn: string,
): Array<{
  gameId: string;
  ply: number;
  san: string;
  uci: string;
  fenBefore: string;
  phase: Phase;
  clockMs: number | null;
  moveTimeMs: number | null;
}> {
  return walkGame(pgn).plies.map((ply) => ({
    gameId,
    ply: ply.ply,
    san: ply.san,
    uci: ply.uci,
    fenBefore: ply.fenBefore,
    phase: phaseFor(ply.fenBefore, ply.ply),
    clockMs: ply.clockMs,
    moveTimeMs: ply.moveTimeMs,
  }));
}

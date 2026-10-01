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
 * Strip NAGs ($NN) from the movetext before chess.js parses it.
 *
 * chess.js's PEG rejects a brace comment immediately followed by a NAG, a
 * shape real exports and studies produce (`{ 0.22 } $14`, inside variations
 * too): the parser accepts the comment, then chokes on the `$`. The comment
 * is where this walk reads `%clk`, so it stays; only the NAG, which carries
 * no move information the walk stores, goes. One linear pass, no structure.
 * Kept separate from `mergeAdjacentComments` so each repair has one name and
 * one test.
 */
export function stripNags(pgn: string): string {
  return pgn.replace(/\$[0-9]+/g, ' ');
}

/**
 * The `%clk` for each mainline ply, read from the cleaned movetext in move
 * order. chess.js stores comments keyed by the after-move FEN
 * (`_comments[fen()]`), so a repeated or transposed position keeps only the
 * last occurrence's comment, and a FEN-keyed walk reports one clock for every
 * ply that reaches the same position. Reading here instead reproduces
 * chess.js's mainline placement (a comment after a move is that move's ply)
 * without the FEN-keyed overwrite. Variation content is skipped by depth, so
 * a clock inside a line annotates nothing on the mainline.
 */
function mainlineClocks(cleaned: string, sanByPly: readonly string[]): Map<number, number> {
  const clocks = new Map<number, number>();
  let ply = 0;
  let depth = 0;
  const token = /\(|\)|\d+\.{1,3}|\d+|\{[^}]*\}|[^\s(){}]+/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(cleaned)) !== null) {
    const value = match[0];
    if (value === '(') {
      depth += 1;
      continue;
    }
    if (value === ')') {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (value.startsWith('{')) {
      if (depth === 0 && ply > 0) {
        const ms = parseClockMs(value);
        if (ms !== null) clocks.set(ply - 1, ms);
      }
      continue;
    }
    if (ply === 0 && /^\d+$/.test(value)) {
      // A lone number is a move number when nothing yet leads it (or the tail
      // of a "1." token); it never equals a san, so the match below ignores it.
      continue;
    }
    if (depth === 0 && ply < sanByPly.length && value === sanByPly[ply]) {
      ply += 1;
    }
  }
  return clocks;
}

/**
 * Replay the PGN into plies and the positions they were played from. Throws
 * when the PGN has no moves.
 */
export function walkGame(pgn: string): Walk {
  const cleaned = stripNags(mergeAdjacentComments(pgn));
  const chess = new Chess();
  chess.loadPgn(cleaned);
  const history = chess.history({ verbose: true });
  if (history.length === 0) throw new Error('game has no moves to analyse');

  // `%clk` rides on the position a move reached. chess.js exposes it through
  // `getComments()`, keyed by the after-move FEN, so a ply's remaining clock is
  // the comment attached to that ply's `after` position. Clocks are read from
  // the movetext instead so a repeated position keeps each ply's own clock.
  const clockMsByPly = mainlineClocks(
    cleaned,
    history.map((move) => move.san),
  );

  // Time spent on a move is the same side's previous remaining clock minus this
  // one; the first move of each side has no previous clock, so it is null.
  const prevClock: Record<Color, number | null> = { white: null, black: null };

  const plies = history.map((move, index) => {
    // Move number and side to move are read off the FEN rather than counted
    // from one, so a game that starts from a position mid-game still numbers
    // its moves the way a player would say them.
    const fields = move.before.split(' ');
    const movingColor = fields[1] === 'b' ? ('black' as const) : ('white' as const);
    const clockMs = clockMsByPly.get(index) ?? null;
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

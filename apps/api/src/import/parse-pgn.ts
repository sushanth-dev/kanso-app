/**
 * The PGN parsing boundary.
 *
 * A PGN upload is the first large, user-supplied, structured document the API
 * accepts, so this file is where it stops being text and becomes data. It is
 * pure: no database, no request, no clock. Everything downstream trusts the
 * `stream` tag, so a game that cannot be parsed cleanly is a fault here rather
 * than a row inserted and skipped later (F2, the story's boundary rule).
 *
 * chess.js parses one game at a time and throws on the second `[Event`, so a
 * multi-game file is split before any game is loaded. A single illegal move
 * fails its game, and one failed game fails the whole upload: a player who
 * uploads ten games and is silently given nine has been told nothing.
 */
import { createHash } from 'node:crypto';
import { Chess } from 'chess.js';

/** Mirrors the `GameResult` contract enum; a game with no result tag is `*`. */
export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*';

export interface ParsedGame {
  pgn: string;
  pgnHash: string;
  result: GameResult;
  whiteName: string | null;
  blackName: string | null;
  whiteElo: number | null;
  blackElo: number | null;
  event: string | null;
  site: string | null;
  round: number | null;
  board: number | null;
  eco: string | null;
  opening: string | null;
  timeControl: string | null;
  playedAt: Date | null;
  moveCount: number;
  hasClockData: boolean;
}

export interface ParseFault {
  /** 0-based position of the failing game in the uploaded file. */
  index: number;
  reason: string;
  /**
   * Set when the fault is the upload's game count rather than one game's
   * moves, so the route can answer with a cap message instead of a parse
   * error for a file whose every game is individually fine.
   */
  code?: 'too_many_games';
}

export type ParseResult = { ok: true; games: ParsedGame[] } | { ok: false; faults: ParseFault[] };

/** A game count cap, so a file claiming ten thousand games is rejected on its shape. */
const DEFAULT_MAX_GAMES = 500;

/** A stable content hash. `game_pgn_unique` makes a re-upload idempotent on it. */
export function pgnHash(pgn: string): string {
  // Normalise line endings and trailing whitespace so a file re-saved by a
  // different editor still hashes to the same game. The move text itself is
  // untouched, so two genuinely different games never collide.
  const normalised = pgn.replace(/\r\n/g, '\n').trim();
  return createHash('sha256').update(normalised).digest('hex');
}

/**
 * Split a possibly-multi-game PGN into single-game texts. A new game begins at a
 * `[Event`/`[` tag line that follows movetext, which is the only unambiguous
 * boundary: blank lines appear inside a game between the tags and the moves.
 */
export function splitGames(pgn: string): string[] {
  // ponytail: adjacent tag blocks with no movetext AND no result line between
  // them merge into one chunk; that chunk then fails to parse and the whole
  // upload is rejected (F2 holds), only the fault index is imprecise. Widen
  // only if a real malformed export needs a precise index.
  const lines = pgn.replace(/\r\n/g, '\n').split('\n');
  const games: string[] = [];
  let current: string[] = [];
  let sawMoves = false;

  for (const line of lines) {
    const isTag = /^\s*\[/.test(line);
    if (isTag && sawMoves) {
      games.push(current.join('\n').trim());
      current = [];
      sawMoves = false;
    }
    if (!isTag && line.trim() !== '') sawMoves = true;
    current.push(line);
  }
  const last = current.join('\n').trim();
  if (last !== '') games.push(last);
  return games.filter((g) => g !== '');
}

const num = (v: string | null | undefined): number | null => {
  if (v == null) return null;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};

const str = (v: string | null | undefined): string | null =>
  v == null || v === '' || v === '?' ? null : v;

/** `[Round "3.32"]` → round 3, board 32. `[Round "3"]` → round 3, board null. */
function roundAndBoard(
  round: string | null | undefined,
  boardTag: string | null | undefined,
): { round: number | null; board: number | null } {
  const explicitBoard = num(boardTag);
  if (round == null) return { round: null, board: explicitBoard };
  const [r, b] = round.split('.');
  return { round: num(r), board: explicitBoard ?? num(b) };
}

/** `[UTCDate]`/`[UTCTime]` first, then `[Date]`; `????.??.??` and junk → null. */
function playedAt(h: Record<string, string | null>): Date | null {
  const date = str(h.UTCDate) ?? str(h.Date);
  if (date == null || date.includes('?')) return null;
  const time = str(h.UTCTime) ?? '00:00:00';
  const iso = `${date.replace(/\./g, '-')}T${time}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Strip brace comments and NAGs from movetext before chess.js parses it.
 *
 * chess.js's PEG rejects some combinations real exports produce, most
 * commonly a comment directly after a NAG inside a variation (`$17 { [%cal
 * Gd8g5] }`). Comments and NAGs carry no move information and no tag we
 * store, so stripping them loses nothing. Clock data is detected from the raw
 * movetext before stripping, so `hasClockData` is unaffected.
 */
function stripAnnotations(movetext: string): string {
  return movetext.replace(/\{[^}]*\}/g, ' ').replace(/\$[0-9]+/g, ' ');
}

export function parseOne(text: string, index: number): ParsedGame | ParseFault {
  const lines = text.split('\n');
  const tags = lines.filter((line) => line.startsWith('[')).join('\n');
  const movetext = lines.filter((line) => !line.startsWith('[')).join(' ');
  const hasClockData = /%clk|%emt/.test(movetext);

  const chess = new Chess();
  try {
    // Keep the tags intact and only clean the movetext, so a stripped game
    // still hashes to the same game as the raw upload.
    chess.loadPgn(`${tags}\n\n${stripAnnotations(movetext)}`, { strict: false });
  } catch (error) {
    return {
      index,
      reason: error instanceof Error ? error.message : 'unparseable game',
    };
  }
  const h = chess.getHeaders();
  const result = (str(h.Result) ?? '*') as GameResult;
  const { round, board } = roundAndBoard(h.Round, h.Board);

  return {
    pgn: text,
    pgnHash: pgnHash(text),
    result,
    whiteName: str(h.White),
    blackName: str(h.Black),
    whiteElo: num(h.WhiteElo),
    blackElo: num(h.BlackElo),
    event: str(h.Event),
    site: str(h.Site),
    round,
    board,
    eco: str(h.ECO),
    opening: str(h.Opening),
    timeControl: str(h.TimeControl),
    playedAt: playedAt(h),
    moveCount: chess.history().length,
    hasClockData,
  };
}

export function parsePgn(pgn: string, opts: { maxGames?: number } = {}): ParseResult {
  const max = opts.maxGames ?? DEFAULT_MAX_GAMES;
  const chunks = splitGames(pgn);
  if (chunks.length === 0) {
    return {
      ok: false,
      faults: [{ index: 0, reason: 'no games found in upload' }],
    };
  }
  if (chunks.length > max) {
    return {
      ok: false,
      faults: [
        {
          index: 0,
          reason: `too many games in one upload: ${chunks.length} > ${max}`,
          code: 'too_many_games',
        },
      ],
    };
  }

  const games: ParsedGame[] = [];
  const faults: ParseFault[] = [];
  chunks.forEach((chunk, index) => {
    const parsed = parseOne(chunk, index);
    if ('reason' in parsed) faults.push(parsed);
    else games.push(parsed);
  });

  // One malformed game fails the whole upload (F2). Nothing is stored on a
  // partial file, so a nine-of-ten import cannot happen.
  return faults.length > 0 ? { ok: false, faults } : { ok: true, games };
}

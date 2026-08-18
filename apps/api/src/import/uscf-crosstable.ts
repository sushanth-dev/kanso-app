/**
 * ST-041. The USCF crosstable fetch.
 *
 * One module per external provider (ADR-0018): direct `fetch`, no SDK. A USCF
 * tournament is published as a crosstable, a public table of results with no
 * movetext. Each player's row carries a round-by-round `color-opponent-result`
 * string per round; the result is a score, not a game score, so the provider
 * synthesises a header-only PGN per round and the import stores a result-only
 * game.
 *
 * The live fetch is best-effort. USCF's MSA has no public API and is being
 * phased out in favour of MUIR, so the search and crosstable URLs are the
 * documented MSA patterns and may change. The parse and synthesis below are the
 * tested core; the fetch returns `ok: false`, never throws.
 */
import { GAME_FETCH_TIMEOUT_MS } from './game-fetch-constants.ts';
import type { FetchGamesOutcome, ProviderGame } from './game-fetcher.ts';
import { isNameMatch, parseName } from '../chess/pgn-name-match.ts';

// ─── The crosstable, parsed ─────────────────────────────────────────────────

export interface CrosstableRound {
  round: number;
  color: 'white' | 'black';
  /** The opponent's 1-based row in the crosstable. */
  opponent: number;
  /** The game result from the player's side. */
  result: '1-0' | '0-1' | '1/2-1/2' | '*';
}

export interface CrosstablePlayer {
  name: string;
  rating: number | null;
  rounds: CrosstableRound[];
}

/**
 * A round cell: `W-12-1` is colour, opponent row, and score. `1` is a win, `0`
 * a loss, `½`/`0.5`/`D` a draw; anything else (bye, forfeit, an unplayed
 * round) is `*`. An empty cell is a round the player did not sit.
 */
const ROUND_CELL = /^([WB])-(\d+)-(\d|0\.5|½|D|=)?$/;

function toGameResult(color: 'white' | 'black', score: string): CrosstableRound['result'] {
  if (score === '½' || score === '0.5' || score === 'D' || score === '=') return '1/2-1/2';
  if (score === '1') return color === 'white' ? '1-0' : '0-1';
  if (score === '0') return color === 'white' ? '0-1' : '1-0';
  return '*';
}

/** Split a CSV line, tolerating a quoted name with commas. */
function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

/**
 * Parse the USCF MSA crosstable CSV: a header row, then one player per line as
 * `rank,name,rating,total,R1,R2,...`, where each round cell is the
 * `color-opponent-result` string above. The opponent is addressed by row, so a
 * row's position in the file is its identity.
 */
export function parseCrosstable(csv: string): CrosstablePlayer[] {
  const players: CrosstablePlayer[] = [];
  for (const line of csv.trim().split('\n')) {
    const cells = splitCsv(line);
    if (cells.length < 5) continue;
    const [, name, ratingText, , ...roundCells] = cells;
    if (!name) continue;

    const rounds: CrosstableRound[] = [];
    roundCells.forEach((cell, index) => {
      if (!cell) return;
      const match = ROUND_CELL.exec(cell);
      if (!match) return;
      rounds.push({
        round: index + 1,
        color: match[1] === 'W' ? 'white' : 'black',
        opponent: Number(match[2]),
        result: toGameResult(match[1] === 'W' ? 'white' : 'black', match[3] ?? '*'),
      });
    });

    // A line with no decodable rounds is the header or noise; skip it.
    if (rounds.length === 0) continue;
    players.push({
      name: name.replace(/^"|"$/g, ''),
      rating: ratingText ? Number(ratingText) || null : null,
      rounds,
    });
  }
  return players;
}

/** A header-only PGN for one round, carrying the tags the parser reads. */
function synthesizePgn(
  event: string,
  round: number,
  white: { name: string; rating: number | null },
  black: { name: string; rating: number | null },
  result: CrosstableRound['result'],
): string {
  const tags = [
    `[Event "${event}"]`,
    `[Site "USCF"]`,
    `[Round "${round}"]`,
    `[White "${white.name}"]`,
    `[Black "${black.name}"]`,
    `[Result "${result}"]`,
  ];
  if (white.rating != null) tags.push(`[WhiteElo "${white.rating}"]`);
  if (black.rating != null) tags.push(`[BlackElo "${black.rating}"]`);
  return `${tags.join('\n')}\n\n`;
}

/**
 * Turn a parsed crosstable into the named player's games. The player must match
 * their row by the ST-003/ST-010 surname-anchored matcher; a near-miss (a
 * shared surname, no full match) is refused with the closest name, and two
 * exact matches are refused as ambiguous, so a typo or a namesake is a visible
 * error rather than a silent wrong import.
 */
export function synthesizeGames(
  players: CrosstablePlayer[],
  playerName: string,
  event: string,
  tournamentId: string,
  maxGames: number,
): { ok: true; games: ProviderGame[] } | { ok: false; detail: string } {
  const matches = players.filter((p) => isNameMatch(playerName, p.name));
  if (matches.length === 0) {
    const surname = parseName(playerName).surname;
    const namesake = surname !== null && players.some((p) => parseName(p.name).surname === surname);
    return {
      ok: false,
      detail: namesake
        ? `This tournament lists a ${surname} but not ${playerName}; check the spelling.`
        : `No player named ${playerName} in this tournament.`,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      detail: `More than one ${playerName} in this tournament; cannot tell them apart.`,
    };
  }

  const player = matches[0]!;
  const games: ProviderGame[] = [];
  for (const round of player.rounds) {
    if (games.length >= maxGames) break;
    const opponent = players[round.opponent - 1];
    if (opponent == null) continue;
    const white =
      round.color === 'white'
        ? { name: player.name, rating: player.rating }
        : { name: opponent.name, rating: opponent.rating };
    const black =
      round.color === 'white'
        ? { name: opponent.name, rating: opponent.rating }
        : { name: player.name, rating: player.rating };
    games.push({
      externalId: `${tournamentId}:${round.round}`,
      pgn: synthesizePgn(event, round.round, white, black, round.result),
    });
  }

  if (games.length === 0) {
    return { ok: false, detail: `No playable rounds for ${playerName} in this tournament.` };
  }
  return { ok: true, games };
}

// ─── The live fetch ─────────────────────────────────────────────────────────

const MSA_BASE = 'https://new.uschess.org/msa/msa_website';

/**
 * Resolve a tournament name to a USCF tournament id. Best-effort: USCF has no
 * public API, and this is the documented MSA search page, addressed by id. The
 * piece most likely to break when MSA becomes MUIR.
 */
async function resolveTournamentId(name: string): Promise<string | null> {
  try {
    const res = await fetch(`${MSA_BASE}/search.cfm?q=${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(GAME_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = /standings\.cfm\?tid=(\d+)/.exec(html);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Fetch the crosstable page for a tournament id; null on any failure. */
async function fetchCrosstable(tid: string): Promise<string | null> {
  try {
    const res = await fetch(`${MSA_BASE}/standings.cfm?tid=${tid}`, {
      signal: AbortSignal.timeout(GAME_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function fetchUscfCrosstable(
  tournamentName: string,
  playerName: string,
  maxGames: number,
): Promise<FetchGamesOutcome> {
  const tid = await resolveTournamentId(tournamentName);
  if (tid === null) return { ok: false, code: 'tournament_not_found' };

  const crosstable = await fetchCrosstable(tid);
  if (crosstable === null) return { ok: false, code: 'upstream_error' };

  const built = synthesizeGames(
    parseCrosstable(crosstable),
    playerName,
    tournamentName,
    tid,
    maxGames,
  );
  if (!built.ok) return { ok: false, code: 'name_mismatch', detail: built.detail };
  return { ok: true, games: built.games };
}

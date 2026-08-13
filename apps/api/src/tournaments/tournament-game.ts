/**
 * The player-relative view of one tournament game, derived from the stored
 * colour and the raw PGN result.
 *
 * This is the one derived logic in the read model, so it lives as a pure
 * function over the stored row rather than inline in the handler. The opponent
 * is whichever of `whiteName` and `blackName` is not the player's side, and the
 * result is from the player's point of view rather than the raw PGN tag. Both
 * are null when the player's side was never decided, because there is no way to
 * know which name is theirs or which direction the result should read.
 */
import type { game } from '../db/schema.ts';

export type PlayerResult = 'win' | 'draw' | 'loss';

/** Points: 1 for a win, 0.5 for a draw, 0 otherwise. */
export function resultPoints(result: PlayerResult): number {
  return result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
}

export interface TournamentGameView {
  id: string;
  round: number | null;
  board: number | null;
  opponent: string | null;
  playerColor: 'white' | 'black' | null;
  result: PlayerResult | null;
  analysed: boolean;
}

export function toTournamentGame(row: typeof game.$inferSelect): TournamentGameView {
  const colour = row.playerColor;
  const opponent = colour === 'white' ? row.blackName : colour === 'black' ? row.whiteName : null;

  let result: PlayerResult | null = null;
  if (colour !== null) {
    const whiteWon = row.result === '1-0';
    const blackWon = row.result === '0-1';
    const draw = row.result === '1/2-1/2';
    if (draw) {
      result = 'draw';
    } else if (whiteWon || blackWon) {
      // A win from the player's side: white won and they were white, or black
      // won and they were black.
      result = whiteWon === (colour === 'white') ? 'win' : 'loss';
    }
  }

  return {
    id: row.id,
    round: row.round,
    board: row.board,
    opponent,
    playerColor: colour,
    result,
    analysed: row.analysisStatus === 'complete',
  };
}

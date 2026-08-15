/**
 * ST-023. The game-fetch seam.
 *
 * The same shape as the rating-fetch seam (ST-018): the app talks to an
 * interface, the real fetchers are the default, and tests inject a fake so no
 * test makes a real outbound call. One module per provider sits behind this
 * interface (ADR-0018).
 *
 * Unlike the rating seam, whose answer is a number or null, a game fetch has
 * three answers the caller must tell apart: games, a username that does not
 * resolve, or an upstream error. The provider modules fetch and split into
 * single-game `ProviderGame`s; the parse, validate, and store path stays in
 * one place and receives them.
 */
import { fetchChesscomGames } from './chesscom-games.ts';
import { fetchLichessGames } from './lichess-games.ts';

export interface ProviderGame {
  /** The provider's own game id; null only when the provider gives none. */
  externalId: string | null;
  /** A single game's PGN text, ready for the parse boundary. */
  pgn: string;
}

export type FetchGamesOutcome =
  | { ok: true; games: ProviderGame[] }
  | { ok: false; code: 'username_not_found' }
  | { ok: false; code: 'upstream_error' };

export interface GameFetcher {
  chesscom(username: string, since: Date): Promise<FetchGamesOutcome>;
  lichess(username: string, since: Date): Promise<FetchGamesOutcome>;
}

export const httpGameFetcher: GameFetcher = {
  chesscom: fetchChesscomGames,
  lichess: fetchLichessGames,
};

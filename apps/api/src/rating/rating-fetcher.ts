/**
 * ST-018. The rating-fetch seam.
 *
 * The same shape as the mailer seam: the app talks to an interface, the real
 * fetchers are the default, and tests inject a fake so no test makes a real
 * outbound call. One module per provider sits behind this interface (ADR-0018).
 */
import { fetchChesscomRating } from './chesscom.ts';
import { fetchLichessRating } from './lichess.ts';

export interface RatingFetcher {
  chesscom(username: string): Promise<number | null>;
  lichess(username: string): Promise<number | null>;
}

export const httpRatingFetcher: RatingFetcher = {
  chesscom: fetchChesscomRating,
  lichess: fetchLichessRating,
};

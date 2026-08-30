/**
 * ST-096. Shared analysis-status helpers for the routes that render an
 * analysing state: the report, the review page, and the import's destination
 * rule. The floor mirrors the API's `MIN_RATED_GAMES` in
 * apps/api/src/analysis/performance-rating.ts; keep the two in sync.
 */
import type { AnalysisStatus, Color } from './api/diagnosis-api.ts';

/** A report refuses below this many games; a tournament upload under it lands on the review page instead. */
export const MIN_REPORT_GAMES = 6;

/** The fields of a game the predicate reads; GameSummary and GameDetail both satisfy it. */
type AnalysisGame = {
  analysisStatus: AnalysisStatus;
  playerColor: Color | null;
};

/**
 * A game is actively analysing when it is queued or running, or pending with a
 * colour: the import refuses to queue a game whose side it cannot decide
 * (ST-095), so a colourless pending game is waiting for the player, not for
 * the engine.
 */
export function isActiveGame(game: AnalysisGame): boolean {
  return (
    game.analysisStatus === 'queued' ||
    game.analysisStatus === 'analyzing' ||
    (game.analysisStatus === 'pending' && game.playerColor !== null)
  );
}

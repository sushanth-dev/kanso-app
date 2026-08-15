/**
 * ST-024. Attribute an already-classified mistake to one tactical motif.
 *
 * The only inputs are the three the `mistake` row already stores: `fen` (the
 * position the move was played from), `moveSan` (what the player played), and
 * `bestMoveSan` (what the engine wanted instead). The attribution reuses the
 * two primitives in `../chess/diagnostic-utils.ts` rather than writing a second
 * scan: `computeHygiene` for the move played, `findCCT` for the move missed.
 *
 * This is a labeler, not a classifier. `classifyMove` in
 * `../chess/lichess-utils.ts` decided whether the move was bad before this runs,
 * so no threshold that decides badness appears here.
 */
import { computeHygiene, findCCT } from '../chess/diagnostic-utils.ts';

/** The closed motif set. A mistake none of these explains stays null (unattributed). */
export const MOTIFS = ['hanging_piece', 'missed_check', 'missed_capture', 'missed_threat'] as const;
export type Motif = (typeof MOTIFS)[number];

/**
 * The motif for one mistake, or null when none of the four rules cover it.
 *
 * `hanging_piece` is checked first: it is about the move the player actually
 * played, and it is the more concrete and reliable claim when a mistake both
 * hangs a piece and misses a tactic. The three `missed_*` rules are mutually
 * exclusive by construction, because `findCCT` puts a move in exactly one of
 * checks, captures, or threats.
 */
export function attributeMotif(fen: string, moveSan: string, bestMoveSan: string): Motif | null {
  const hygiene = computeHygiene(fen, moveSan);
  if (hygiene !== null && hygiene.defenders > hygiene.attackers) {
    return 'hanging_piece';
  }

  const good = findCCT(fen, bestMoveSan).all.find((m) => m.isGoodOption);
  switch (good?.type) {
    case 'Check':
      return 'missed_check';
    case 'Capture':
      return 'missed_capture';
    case 'Threat':
      return 'missed_threat';
    default:
      return null;
  }
}

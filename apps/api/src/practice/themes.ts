/**
 * ST-106. The bridge from a report weakness group to a Lichess puzzle theme.
 *
 * The report names weakness groups with `groupKeyOf`'s keys; the Lichess
 * puzzle database tags puzzles with its own theme slugs. One mapping joins
 * the two, and it is an approximation in both directions: Lichess tags a
 * puzzle by the tactical idea of its solution, not by the mistake the solver
 * was meant to learn from. The closest honest theme per group:
 *
 * - `hanging_piece` drills `hangingPiece`, loose-piece awareness both ways.
 * - `missed_check` drills `intermezzo`, the forcing-move-in-between theme,
 *   because the dump has no plain "find the check" tag.
 * - `missed_capture` drills `advantage`, winning material by force.
 * - `missed_threat` drills `crushing`, spotting the strong continuation.
 * - The phase groups drill the same-name themes; an opening group keys on an
 *   ECO code the dump does not carry, so it drills `opening`-themed puzzles -
 *   after ST-122's opening rungs have preferred the ECO family the
 *   generated `eco-openings.ts` maps it to.
 * - `time_trouble` has no theme of its own; the drill is decisive-move
 *   spotting, so `crushing`.
 *
 * Retuning this table is a one-file change with its test; the drill's
 * fallback ladder (see `assemble.ts`) keeps every group solvable regardless
 * of how well the mapped theme is stocked.
 */
import type { WeaknessKind } from '../analysis/leak.ts';

const MOTIF_THEMES: Record<string, string> = {
  hanging_piece: 'hangingPiece',
  missed_check: 'intermezzo',
  missed_capture: 'advantage',
  missed_threat: 'crushing',
};

const PHASE_THEMES: Record<string, string> = {
  opening: 'opening',
  middlegame: 'middlegame',
  endgame: 'endgame',
};

/**
 * The theme one weakness group drills, or null when the group is unknown.
 * The kind decides which table the group key reads from, exactly as
 * `groupKeyOf` decided which table produced it; an opening group keys on the
 * ECO code `groupKeyOf` returned, so any group under the `opening` kind maps
 * to the opening theme, with the mapped ECO family preferred first.
 */
export function themeForGroup(kind: WeaknessKind, groupKey: string): string | null {
  switch (kind) {
    case 'opening':
      return 'opening';
    case 'time_trouble':
      return 'crushing';
    case 'motif':
      return MOTIF_THEMES[groupKey] ?? null;
    case 'phase':
      return PHASE_THEMES[groupKey] ?? null;
  }
}

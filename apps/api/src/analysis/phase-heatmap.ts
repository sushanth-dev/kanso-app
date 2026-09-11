/**
 * ST-155. The phase heatmap: where in the game the costliest mistakes sit.
 *
 * One query over the leak scope - the same rated, analysed, in-window game
 * set every report figure is drawn from - grouping the player's mistakes by
 * phase and summing the ST-149 severity-weighted half-points, so the heatmap
 * ranks with the identical weight the leak scored with. Never stored: it is
 * recomputed on each report read, the missed-punishment pattern.
 *
 * The split mirrors `leak.ts` and `phases.ts`: {@link phaseHeatmap} is the
 * query, {@link composePhaseHeatmap} is the pure composition over its output,
 * testable with no database.
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import { game, mistake } from '../db/schema.ts';
import { leakScope, severityWeightSql } from './leak.ts';

type Db = PostgresJsDatabase<typeof schema>;
type Stream = (typeof schema.streamEnum.enumValues)[number];
type Phase = (typeof schema.phaseEnum.enumValues)[number];

/**
 * The instances a phase cell needs before its cost figure may be shown.
 * Below the floor the cell keeps its count and withholds the cost, the same
 * three-instance floor the motif aggregates refuse at.
 */
export const HEATMAP_CELL_FLOOR = 3;

/** One aggregated phase row, as the query returns it before composition. */
export interface PhaseCostRow {
  phase: Phase;
  occurrences: number;
  halfPointsLost: number;
  severityWeightedCost: number;
}

/** One rendered heatmap cell. `severityWeightedCost` is null below the floor. */
export interface PhaseHeatmapCell {
  phase: Phase;
  occurrences: number;
  halfPointsLost: number;
  severityWeightedCost: number | null;
}

/** The phases in the fixed order the heatmap renders, the `scorePhases` order. */
const PHASE_ORDER: readonly Phase[] = ['opening', 'middlegame', 'endgame'];

/**
 * Zero-fill all three phases in fixed order - a quiet phase reads as quiet,
 * not as missing - and withhold the cost figure where the cell is thin. The
 * count is never withheld: it is honest at any size.
 */
export function composePhaseHeatmap(rows: PhaseCostRow[]): PhaseHeatmapCell[] {
  const byPhase = new Map(rows.map((r) => [r.phase, r]));
  return PHASE_ORDER.map((phase) => {
    const row = byPhase.get(phase);
    const occurrences = row?.occurrences ?? 0;
    return {
      phase,
      occurrences,
      halfPointsLost: row?.halfPointsLost ?? 0,
      severityWeightedCost:
        row === undefined || occurrences < HEATMAP_CELL_FLOOR ? null : row.severityWeightedCost,
    };
  });
}

/** The heatmap for one report scope: never stored, recomputed on each read. */
export async function phaseHeatmap(
  db: Db,
  playerId: string,
  stream: Stream,
  windowStart: Date | null,
  tournamentId?: string,
): Promise<PhaseHeatmapCell[]> {
  if (windowStart === null) return [];
  const rows = await db
    .select({
      phase: mistake.phase,
      occurrences: sql<number>`count(${mistake.id})::int`,
      halfPointsLost: sql<number>`coalesce(sum(${mistake.halfPointsLost}), 0)::float8`,
      severityWeightedCost: sql<number>`coalesce(sum(${severityWeightSql} * ${mistake.halfPointsLost}), 0)::float8`,
    })
    .from(mistake)
    .innerJoin(game, eq(mistake.gameId, game.id))
    .where(and(leakScope(playerId, stream, windowStart, tournamentId), isNotNull(mistake.phase)))
    .groupBy(mistake.phase);
  // The where clause filters null phases out; the select type cannot know.
  return composePhaseHeatmap(rows.filter((r): r is PhaseCostRow => r.phase !== null));
}

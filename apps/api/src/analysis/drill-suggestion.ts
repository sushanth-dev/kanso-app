/**
 * ST-155. The drill budget: which weakness group the next deal should be for.
 *
 * The report's rank orders by season severity-weighted cost. The suggestion
 * reorders the same candidate groups by *recent* cost, weighted by where the
 * recent mistakes sit: each group's score is the sum over its recent mistakes
 * of `severityWeight x halfPointsLost x phaseCost(phase)`, where `phaseCost`
 * is the player's own recent per-phase severity-weighted cost, normalized so
 * the worst phase weighs 1 and a quiet phase weighs near 0.
 *
 * A phase group's score reduces to its own recent cost; an opening or motif
 * group concentrates where its recent slips sit. So a group whose recent
 * mistakes sit in the bleeding phase outranks an equal-cost group whose slips
 * sit elsewhere - the phase bleeding the most rating points gets the next
 * deal, the story's one sentence.
 *
 * One mistake belongs to several candidate groups at once (its ECO, its
 * motif, its phase, the trouble window), so the curve is computed once over
 * the raw rows and each candidate scores against its own membership; the
 * per-group expansion never feeds back into the curve.
 *
 * The split mirrors `leak.ts`: {@link recentMistakes} is the query,
 * {@link orderSuggestions} is the pure ordering over its output, testable
 * with no database.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import { game, mistake, movePly } from '../db/schema.ts';
import { leakScope, opponentEloExpr } from './leak.ts';
import { SEASON_WINDOW_MS } from './performance-rating.ts';
import { TROUBLE_CLOCK_MS } from '../phases/phases.ts';
import { severityWeight } from './severity.ts';

type Db = PostgresJsDatabase<typeof schema>;
type Stream = (typeof schema.streamEnum.enumValues)[number];
type Phase = (typeof schema.phaseEnum.enumValues)[number];
type WeaknessKind = 'opening' | 'motif' | 'phase' | 'time_trouble';

/**
 * The trailing window "recent" means. The season window makes recent mean
 * nothing and a week makes the window twitchy; thirty days is the same
 * rolling length `missed-punishment.ts` already reports beside its season
 * count, and the same data anchor: the window ends where the season window
 * ends, so it moves with the games rather than with the clock.
 */
export const SUGGESTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** One recent mistake, with every group it could belong to. */
export interface RecentMistake {
  phase: Phase | null;
  halfPointsLost: number;
  /** The opponent's Elo, null when unknown; the weight falls back to neutral. */
  opponentElo: number | null;
  /** The game's ECO code, the opening group the mistake feeds. */
  eco: string | null;
  /** The motif attributed to the mistake, null when no motif explains it. */
  motif: string | null;
  /** True when the ply fell inside the trouble window, the time_trouble group. */
  inTrouble: boolean;
}

/** One mistake's severity-weighted half-points, the TS twin of the SQL sum. */
function weightedCost(m: RecentMistake): number {
  return m.halfPointsLost * severityWeight(m.opponentElo).weight;
}

/**
 * The per-phase cost curve over the raw rows, normalized to the worst phase.
 * Zero total cost means every phase weighs equally: with nothing to point at,
 * the weighting degrades to the unweighted recent cost, the honest fallback.
 */
export function phaseCostCurve(mistakes: RecentMistake[]): Map<Phase, number> {
  const raw = new Map<Phase, number>([
    ['opening', 0],
    ['middlegame', 0],
    ['endgame', 0],
  ]);
  for (const m of mistakes) {
    if (m.phase === null) continue;
    raw.set(m.phase, (raw.get(m.phase) ?? 0) + weightedCost(m));
  }
  const worst = Math.max(...raw.values(), 0);
  const curve = new Map<Phase, number>();
  for (const [phase, cost] of raw) {
    curve.set(phase, worst > 0 ? cost / worst : 1);
  }
  return curve;
}

/** Does one raw mistake belong to one candidate group? */
function belongsTo(m: RecentMistake, kind: WeaknessKind, key: string): boolean {
  switch (kind) {
    case 'opening':
      return m.eco !== null && m.eco === key;
    case 'motif':
      return m.motif !== null && m.motif === key;
    case 'phase':
      return m.phase !== null && m.phase === key;
    case 'time_trouble':
      return m.inTrouble && key === 'time_trouble';
  }
}

/**
 * One suggestion as the report response carries it: the group, its label
 * copy for the link, and its recent cost figure.
 */
export interface DrillSuggestion {
  kind: WeaknessKind;
  /** The group key, as the practice link carries it. */
  groupKey: string;
  label: string;
  /** The group's recent severity-weighted cost, the figure the order speaks in. */
  recentCost: number;
  /** The phase-weighted score, how the order is chosen. */
  score: number;
}

/**
 * Order candidates by phase-weighted recent cost, worst first. A group with
 * no recent mistakes scores zero and falls to the back; ties break by raw
 * recent cost, then by kind and key so the order is stable across reads.
 */
export function orderSuggestions(
  candidates: { kind: WeaknessKind; groupKey: string; label: string }[],
  mistakes: RecentMistake[],
): DrillSuggestion[] {
  const curve = phaseCostCurve(mistakes);
  return candidates
    .map((c) => {
      let recentCost = 0;
      let score = 0;
      for (const m of mistakes) {
        if (!belongsTo(m, c.kind, c.groupKey)) continue;
        const cost = weightedCost(m);
        recentCost += cost;
        score += cost * (m.phase === null ? 1 : (curve.get(m.phase) ?? 1));
      }
      return { ...c, recentCost, score };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.recentCost - a.recentCost ||
        a.kind.localeCompare(b.kind) ||
        a.groupKey.localeCompare(b.groupKey),
    );
}

/**
 * The player's recent mistakes over the suggestion window, one row per
 * mistake with its group memberships attached. The window anchors at the
 * season window's end, the same data anchor the report's `windowEnd` uses.
 */
export async function recentMistakes(
  db: Db,
  playerId: string,
  stream: Stream,
  windowStart: Date,
  tournamentId?: string,
): Promise<RecentMistake[]> {
  const recentStart = new Date(windowStart.getTime() + SEASON_WINDOW_MS - SUGGESTION_WINDOW_MS);
  const rows = await db
    .select({
      phase: mistake.phase,
      halfPointsLost: mistake.halfPointsLost,
      opponentElo: sql<number | null>`${opponentEloExpr}`,
      eco: game.eco,
      motif: mistake.motif,
      clockMs: movePly.clockMs,
    })
    .from(mistake)
    .innerJoin(game, eq(mistake.gameId, game.id))
    .leftJoin(movePly, and(eq(movePly.gameId, mistake.gameId), eq(movePly.ply, mistake.ply)))
    .where(
      and(leakScope(playerId, stream, windowStart, tournamentId), gte(game.playedAt, recentStart)),
    );
  return rows.map((r) => ({
    phase: r.phase,
    halfPointsLost: r.halfPointsLost,
    opponentElo: r.opponentElo,
    eco: r.eco,
    motif: r.motif,
    inTrouble: r.clockMs !== null && r.clockMs <= TROUBLE_CLOCK_MS,
  }));
}

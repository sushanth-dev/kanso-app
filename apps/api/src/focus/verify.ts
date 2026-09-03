/**
 * F12, ADR-0036. The focus verification model: the rolling window, the
 * baseline split, the minimum-evidence refusal, and the trend rule.
 *
 * The window is a count of analysed games, not calendar time, and the baseline
 * is two equal windows split at `focus.startedAt`, because that is what makes
 * the loop mean "did the work help" rather than "is my career average moving".
 * The trend is a fixed per-focus effect size, all four units "higher is
 * better". The model is recorded in ADR-0036 and cited the way
 * `performance-rating.ts` cites ADR-0032.
 */
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import { game } from '../db/schema.ts';
import { classifyTimeControl } from '../chess/time-control.ts';

type Db = PostgresJsDatabase<typeof schema>;
type Stream = (typeof schema.streamEnum.enumValues)[number];

export type FocusTrend = 'improving' | 'flat' | 'declining' | 'insufficient_evidence';

/** F12. The rolling window, in analysed games per half. ST-096 diverged it from the report's `MIN_RATED_GAMES` (6): the focus keeps the stronger ten-game bar. */
export const FOCUS_WINDOW_GAMES = 10;

export interface FocusSpec {
  /** What the two values are in, for the page that explains the number. */
  unit: string;
  /** The effect size that separates a trend from noise, in `unit`. */
  threshold: number;
}

/** The four focuses, keyed by catalogue key. All four units are "higher is better". */
export const FOCUS_SPECS: Record<string, FocusSpec> = {
  converting_won_positions: { unit: 'share converted', threshold: 0.1 },
  time_management: { unit: 'move', threshold: 3 },
  opening_repertoire_results: { unit: 'points per game', threshold: 0.25 },
  tactical_alertness: { unit: 'share found', threshold: 0.1 },
};

/**
 * The trend for one baseline/current pair. A null value is a refusal, so the
 * trend is `insufficient_evidence`; otherwise the fixed effect size decides.
 */
export function trendFor(
  spec: FocusSpec,
  baselineValue: number | null,
  currentValue: number | null,
): FocusTrend {
  if (baselineValue === null || currentValue === null) return 'insufficient_evidence';
  const diff = currentValue - baselineValue;
  if (diff >= spec.threshold) return 'improving';
  if (diff <= -spec.threshold) return 'declining';
  return 'flat';
}

/**
 * ST-116. The distance a refused measurement still owes. 0 exactly when a
 * verdict exists; the current half's deficit when the window floor is the
 * refusing cause; null when importing alone cannot close the gap - a thin
 * baseline half no import can fill, or a scorer refusal whose denominator is
 * not games the player can add. One computation serves both the refusal the
 * verifier makes and the countdown the player sees, so they cannot disagree.
 */
export function gamesToGoFor(
  baselineValue: number | null,
  currentValue: number | null,
  gamesBefore: number,
  windowGames: number,
): number | null {
  if (baselineValue !== null && currentValue !== null) return 0;
  if (gamesBefore >= FOCUS_WINDOW_GAMES && windowGames < FOCUS_WINDOW_GAMES) {
    return FOCUS_WINDOW_GAMES - windowGames;
  }
  return null;
}

/**
 * Split a stream's analysed games, newest first, at `startedAt` into two
 * equal-sized windows: the games since the commitment and the games before it.
 * Each half is capped at {@link FOCUS_WINDOW_GAMES}; the caller decides refusal.
 * `periodStart` is the oldest baseline game and `periodEnd` the newest current
 * game, null when that half is empty.
 */
export function splitWindow(
  startedAt: Date,
  games: { id: string; playedAt: Date | null }[],
): {
  baselineIds: string[];
  currentIds: string[];
  periodStart: Date | null;
  periodEnd: Date | null;
} {
  const baselineIds: string[] = [];
  const currentIds: string[] = [];
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;
  for (const g of games) {
    if (g.playedAt === null) continue;
    if (g.playedAt.getTime() >= startedAt.getTime()) {
      if (currentIds.length < FOCUS_WINDOW_GAMES) {
        if (periodEnd === null) periodEnd = g.playedAt;
        currentIds.push(g.id);
      }
    } else if (baselineIds.length < FOCUS_WINDOW_GAMES) {
      baselineIds.push(g.id);
      periodStart = g.playedAt;
    }
  }
  return { baselineIds, currentIds, periodStart, periodEnd };
}

/** Computes one focus's value over a window of games, or null when it refuses. */
export type FocusValueFn = (gameIds: string[]) => Promise<number | null>;

export interface FocusMeasurementDraft {
  /** The current window's size: how many recent games sit behind the verdict. */
  windowGames: number;
  /** The baseline window's size: how many games sit behind the "before". */
  gamesBefore: number;
  baselineValue: number | null;
  currentValue: number | null;
  /** The span of the evidence: oldest baseline game to newest current game. */
  periodStart: Date | null;
  periodEnd: Date | null;
}

/**
 * Measure one focus over one stream. The online stream counts blitz games
 * only (ST-040): bullet, rapid, and classical online games are excluded before
 * the window splits. A window thinner than the floor refuses without
 * computing, and a focus that refuses its own half returns null for it; both
 * surface as `insufficient_evidence` through {@link trendFor}.
 */
export async function measureFocusStream(
  db: Db,
  playerId: string,
  stream: Stream,
  startedAt: Date,
  computeValue: FocusValueFn,
): Promise<FocusMeasurementDraft> {
  const rows = await db
    .select({ id: game.id, playedAt: game.playedAt, timeControl: game.timeControl })
    .from(game)
    .where(
      and(
        eq(game.playerId, playerId),
        eq(game.stream, stream),
        eq(game.analysisStatus, 'complete'),
        isNotNull(game.playedAt),
      ),
    )
    .orderBy(desc(game.playedAt));

  const games =
    stream === 'online' ? rows.filter((g) => classifyTimeControl(g.timeControl) === 'blitz') : rows;

  const { baselineIds, currentIds, periodStart, periodEnd } = splitWindow(startedAt, games);
  const windowGames = currentIds.length;
  const gamesBefore = baselineIds.length;

  if (baselineIds.length < FOCUS_WINDOW_GAMES || currentIds.length < FOCUS_WINDOW_GAMES) {
    return {
      windowGames,
      gamesBefore,
      baselineValue: null,
      currentValue: null,
      periodStart,
      periodEnd,
    };
  }

  const [baselineValue, currentValue] = await Promise.all([
    computeValue(baselineIds),
    computeValue(currentIds),
  ]);

  return { windowGames, gamesBefore, baselineValue, currentValue, periodStart, periodEnd };
}

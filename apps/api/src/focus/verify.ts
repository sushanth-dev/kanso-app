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
import { and, desc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import { game, puzzleAttempt } from '../db/schema.ts';
import { FocusPractice } from '../contract/schemas.ts';
import { z } from '@hono/zod-openapi';
import { classifyTimeControl } from '../chess/time-control.ts';

type Db = PostgresJsDatabase<typeof schema>;
type Stream = (typeof schema.streamEnum.enumValues)[number];
type WeaknessKind = (typeof schema.weaknessKindEnum.enumValues)[number];

export type FocusTrend = 'improving' | 'flat' | 'declining' | 'insufficient_evidence';

/** F12. The rolling window, in analysed games per half. ST-096 diverged it from the report's `MIN_RATED_GAMES` (6): the focus keeps the stronger ten-game bar. */
export const FOCUS_WINDOW_GAMES = 10;

/**
 * ST-173. The rows one page of a window read asks for: both halves in a single
 * page, so a stream where every game qualifies is read in one query.
 */
export const WINDOW_PAGE_ROWS = 2 * FOCUS_WINDOW_GAMES;

/**
 * ST-173. The page cap for one window read: 500 games. Reaching it means the
 * newest 500 games of the stream held fewer than the floor's two halves, which
 * is thin evidence. The read stops and the window refuses rather than walking
 * the rest of a long history to prove what it already knows.
 */
export const WINDOW_MAX_PAGES = 25;

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
 * ST-129. The drill family each focus draws its practice line from: every
 * catalogue entry's `measureDescription` names exactly one weakness kind,
 * and this map records that join. `converting_won_positions` → `phase` is
 * the loosest pairing - won positions live late, so the phase cards are the
 * drill families a conversion focus works from - an accepted approximation
 * until a focus needs several kinds, which is a new decision.
 */
export const FOCUS_DRILL_KINDS: Record<string, WeaknessKind> = {
  converting_won_positions: 'phase',
  time_management: 'time_trouble',
  opening_repertoire_results: 'opening',
  tactical_alertness: 'motif',
};

/**
 * ST-129. The player's worked drills inside one weakness kind. Rows exist
 * from the moment a deal assigns a puzzle, so `attempts > 0` is what
 * "worked" means; zero worked drills answer the honest zero, not a null -
 * the surface renders that as its own empty state. An unknown kind (no
 * measurable focus) answers null and the surface renders nothing.
 */
export async function practiceSummary(
  db: Db,
  playerId: string,
  kind: WeaknessKind | undefined,
): Promise<z.infer<typeof FocusPractice> | null> {
  if (kind === undefined) return null;
  const [row] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      solved: sql<number>`count(*) filter (where ${puzzleAttempt.solved})`.mapWith(Number),
      groups: sql<number>`count(distinct ${puzzleAttempt.groupKey})`.mapWith(Number),
    })
    .from(puzzleAttempt)
    .where(
      and(
        eq(puzzleAttempt.playerId, playerId),
        eq(puzzleAttempt.kind, kind),
        gt(puzzleAttempt.attempts, 0),
      ),
    );
  return row ?? { total: 0, solved: 0, groups: 0 };
}

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
 * ST-173. Reads an eligible window newest-first, a page at a time, and stops as
 * soon as `enough` holds. The caller owns the order and the eligibility rule;
 * this decides only how far to go. Three things end it: enough rows kept, a
 * page shorter than requested (the history ran out), or the page cap.
 *
 * Stopping early is safe, and that is what makes a bound acceptable here: a
 * window short of the floor refuses to answer, so reading too little can cost a
 * refusal but can never invent a verdict. Reading too much, by contrast, is
 * what the whole change is against.
 */
export async function readWindow<T>(
  fetchPage: (offset: number, limit: number) => Promise<T[]>,
  isEligible: (row: T) => boolean,
  enough: (kept: T[]) => boolean,
  bounds: { pageRows: number; maxPages: number } = {
    pageRows: WINDOW_PAGE_ROWS,
    maxPages: WINDOW_MAX_PAGES,
  },
): Promise<T[]> {
  const kept: T[] = [];
  for (let page = 0; page < bounds.maxPages; page += 1) {
    const rows = await fetchPage(page * bounds.pageRows, bounds.pageRows);
    for (const row of rows) {
      if (isEligible(row)) kept.push(row);
    }
    if (enough(kept) || rows.length < bounds.pageRows) break;
  }
  return kept;
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
  const scope = and(
    eq(game.playerId, playerId),
    eq(game.stream, stream),
    eq(game.analysisStatus, 'complete'),
    isNotNull(game.playedAt),
  );

  // ST-173. This read used to return every analysed game the player had in the
  // stream, which is the whole history once a player has years of it. It stops
  // at the two full halves the floor needs: `splitWindow` discards everything
  // past a full pair of halves, so the rows beyond them bought nothing.
  // `desc(game.id)` breaks ties on a single timestamp, so paging cannot repeat
  // or skip a row.
  const games = await readWindow(
    (offset, limit) =>
      db
        .select({ id: game.id, playedAt: game.playedAt, timeControl: game.timeControl })
        .from(game)
        .where(scope)
        .orderBy(desc(game.playedAt), desc(game.id))
        .limit(limit)
        .offset(offset),
    (row) => stream !== 'online' || classifyTimeControl(row.timeControl) === 'blitz',
    (kept) => {
      const { baselineIds, currentIds } = splitWindow(startedAt, kept);
      return baselineIds.length >= FOCUS_WINDOW_GAMES && currentIds.length >= FOCUS_WINDOW_GAMES;
    },
  );

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

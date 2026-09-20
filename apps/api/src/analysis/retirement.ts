/**
 * ST-150. The verified-retirement machine, driven from analysis completion.
 *
 * A weakness group whose drill pool reaches the mastered bucket becomes a
 * `candidate` (written by the record side). Each analysed game in the group's
 * stream then either keeps the machine waiting or moves it:
 *
 * - An instance of the group in a `retired` row flips it to `came_back` and
 *   fires exactly one alert - the state transition itself, with
 *   `lastAlertGameId` naming the game that triggered the relapse. The
 *   transition happens once per relapse, so two instances in one game are one
 *   alert.
 * - Zero instances for a `candidate` row, plus an analysed-game window since
 *   the row's `masteredAt` of at least {@link FOCUS_WINDOW_GAMES} games (the
 *   same analysed-game filter and blitz-only-online rule as
 *   `measureFocusStream`), retires it. A thinner window flips nothing; the
 *   API derives `not_yet_verifiable` at read time.
 *
 * The window is measured from `masteredAt`, so an old game re-analysed after
 * retirement is neither a new instance nor window material: the instance
 * predates the retirement, and "this came back" would be a lie about it.
 *
 * Every instance this hook reads comes from the game that just completed, and
 * every window game passes through here on its own completion, so the checks
 * stay local to one game.
 *
 * This runs after the analysis transaction has committed. A failure here must
 * never reach `analyseGame`'s catch: the Lambda handler resets the game to
 * `queued` and rethrows, which would pointlessly retry a successfully
 * analysed game. The hook therefore swallows and logs its own errors.
 */
import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { classifyTimeControl } from '../chess/time-control.ts';
import { FOCUS_WINDOW_GAMES, readWindow } from '../focus/verify.ts';
import { log } from '../logging.ts';
import { TROUBLE_CLOCK_MS } from '../phases/phases.ts';
import * as schema from '../db/schema.ts';
import { game, mistake, movePly, patternState, puzzleAttempt } from '../db/schema.ts';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * The group keys this game carries instances for, keyed `kind:key` exactly as
 * report composition keys a group. A mistake is an instance for its motif or
 * phase; a game with any mistake and a known ECO is an instance for that
 * opening; a mistake played at or under the trouble clock is an instance for
 * time trouble.
 */
async function instanceKeysOf(db: Db, gameId: string, eco: string | null): Promise<Set<string>> {
  const rows = await db
    .select({ motif: mistake.motif, phase: mistake.phase })
    .from(mistake)
    .where(eq(mistake.gameId, gameId));
  if (rows.length === 0) return new Set();

  const keys = new Set<string>();
  for (const r of rows) {
    if (r.motif !== null) keys.add(`motif:${r.motif}`);
    if (r.phase !== null) keys.add(`phase:${r.phase}`);
  }
  if (eco !== null) keys.add(`opening:${eco}`);
  const trouble = await db
    .select({ ply: mistake.ply })
    .from(mistake)
    .innerJoin(movePly, and(eq(movePly.gameId, mistake.gameId), eq(movePly.ply, mistake.ply)))
    .where(and(eq(mistake.gameId, gameId), lte(movePly.clockMs, TROUBLE_CLOCK_MS)))
    .limit(1);
  if (trouble.length > 0) keys.add('time_trouble:time_trouble');
  return keys;
}

/** The window's filter, in one place: analysed, played, dated, and, in the online stream, blitz. */
function windowScope(
  playerId: string,
  stream: (typeof schema.streamEnum.enumValues)[number],
  since: Date,
) {
  return and(
    eq(game.playerId, playerId),
    eq(game.stream, stream),
    eq(game.analysisStatus, 'complete'),
    isNotNull(game.playedAt),
    gte(game.playedAt, since),
  );
}

/** The distinct instants in `dates`, keyed by epoch milliseconds, first occurrence winning. */
function distinctTimes(dates: Date[]): Date[] {
  return [...new Map(dates.map((d) => [d.getTime(), d])).values()];
}

/** The analysed game ids in one stream since `since`, uncapped: ST-152's read model needs every id. */
async function windowGameIdsSince(
  db: Db,
  playerId: string,
  stream: (typeof schema.streamEnum.enumValues)[number],
  since: Date,
): Promise<string[]> {
  const rows = await db
    .select({ id: game.id, timeControl: game.timeControl })
    .from(game)
    .where(windowScope(playerId, stream, since));
  if (stream === 'tournament') return rows.map((r) => r.id);
  return rows.filter((r) => classifyTimeControl(r.timeControl) === 'blitz').map((r) => r.id);
}

/**
 * ST-173. The window's size, for every distinct date a caller needs at once,
 * capped at `FOCUS_WINDOW_GAMES`.
 *
 * Every caller asks one question, "is this window thinner than the floor", so a
 * value at the floor means "no" and not "exactly ten"; below the floor the
 * value is exact. The read is bounded in a way the ids read is not: it pages
 * newest-first and stops the moment the floor is reached, instead of returning
 * a whole history for the caller to measure. The rows are also ordered by id
 * within one timestamp, so paging cannot repeat or skip a row.
 */
export async function windowGameCounts(
  db: Db,
  playerId: string,
  stream: (typeof schema.streamEnum.enumValues)[number],
  dates: Date[],
): Promise<Map<number, number>> {
  const counts = await Promise.all(
    distinctTimes(dates).map(async (since) => {
      const rows = await readWindow(
        (offset, limit) =>
          db
            .select({ id: game.id, timeControl: game.timeControl })
            .from(game)
            .where(windowScope(playerId, stream, since))
            .orderBy(desc(game.playedAt), desc(game.id))
            .limit(limit)
            .offset(offset),
        (row) => stream === 'tournament' || classifyTimeControl(row.timeControl) === 'blitz',
        (kept) => kept.length >= FOCUS_WINDOW_GAMES,
      );
      return [since.getTime(), Math.min(rows.length, FOCUS_WINDOW_GAMES)] as const;
    }),
  );
  return new Map(counts);
}

/** One date's window size, through the same counted read. */
export async function windowGameCount(
  db: Db,
  playerId: string,
  stream: (typeof schema.streamEnum.enumValues)[number],
  since: Date,
): Promise<number> {
  return (await windowGameCounts(db, playerId, stream, [since])).get(since.getTime()) ?? 0;
}

/**
 * ST-173. The window's ids, for every distinct date a caller needs at once.
 *
 * This read stays uncapped, and that is deliberate rather than an oversight:
 * ST-152's read model aggregates the window's instances and cost over every id
 * and reports the window's true size in `windowGames`, so truncating would
 * change what that endpoint says. What the change buys here is the query count.
 * Twelve weaknesses sharing one mastery date used to cost twelve full reads;
 * they cost one now.
 */
export async function windowGameIdsForDates(
  db: Db,
  playerId: string,
  stream: (typeof schema.streamEnum.enumValues)[number],
  dates: Date[],
): Promise<Map<number, string[]>> {
  const entries = await Promise.all(
    distinctTimes(dates).map(
      async (since) =>
        [since.getTime(), await windowGameIdsSince(db, playerId, stream, since)] as const,
    ),
  );
  return new Map(entries);
}

/**
 * The post-transaction completion hook. Reads the completed game, then moves
 * every matching `candidate` or `retired` row in its stream. Never throws:
 * see the module comment for why a throw here would retry a finished game.
 */
export async function applyRetirement(db: Db, gameId: string): Promise<void> {
  try {
    const [g] = await db
      .select({
        playerId: game.playerId,
        stream: game.stream,
        eco: game.eco,
        playedAt: game.playedAt,
      })
      .from(game)
      .where(eq(game.id, gameId));
    if (!g) return;

    const keys = await instanceKeysOf(db, gameId, g.eco);
    const rows = await db
      .select({
        id: patternState.id,
        kind: patternState.kind,
        groupKey: patternState.groupKey,
        state: patternState.state,
        masteredAt: patternState.masteredAt,
      })
      .from(patternState)
      .where(
        and(
          eq(patternState.playerId, g.playerId),
          eq(patternState.stream, g.stream),
          inArray(patternState.state, ['candidate', 'retired']),
        ),
      );

    for (const row of rows) {
      // An old game re-analysed after the row was mastered carries no new
      // instance and adds nothing to the window: it predates the candidate.
      const inWindow = g.playedAt !== null && g.playedAt >= row.masteredAt;
      if (inWindow && keys.has(`${row.kind}:${row.groupKey}`)) {
        if (row.state === 'retired') {
          await db
            .update(patternState)
            .set({
              state: 'came_back',
              cameBackAt: new Date(),
              lastAlertGameId: gameId,
              relapses: sql`${patternState.relapses} + 1`,
            })
            .where(eq(patternState.id, row.id));
          // ST-152. A relapse reopens the debt: the group's puzzles drop off
          // the ladder and come back due, so re-mastery is work the drill
          // queue can see rather than a formality the row keeps.
          await db
            .update(puzzleAttempt)
            .set({ reviewLevel: 0, nextReviewAt: sql`now()` })
            .where(
              and(
                eq(puzzleAttempt.playerId, g.playerId),
                eq(puzzleAttempt.kind, row.kind),
                eq(puzzleAttempt.groupKey, row.groupKey),
              ),
            );
          log('info', 'pattern_came_back', {
            gameId,
            kind: row.kind,
            group: row.groupKey,
            stream: g.stream,
          });
        }
        continue;
      }
      if (row.state === 'candidate' && inWindow) {
        // ST-173. A capped count: `FOCUS_WINDOW_GAMES` here means the window
        // reached the floor, which is the only thing this check asks.
        const count = await windowGameCount(db, g.playerId, g.stream, row.masteredAt);
        if (count >= FOCUS_WINDOW_GAMES) {
          await db
            .update(patternState)
            .set({ state: 'retired', retiredAt: new Date() })
            .where(eq(patternState.id, row.id));
          log('info', 'pattern_retired', {
            gameId,
            kind: row.kind,
            group: row.groupKey,
            stream: g.stream,
            windowGames: count,
          });
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'retirement check failed';
    log('warn', 'retirement_check_failed', { gameId, error: message });
  }
}

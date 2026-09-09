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
import { and, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { classifyTimeControl } from '../chess/time-control.ts';
import { FOCUS_WINDOW_GAMES } from '../focus/verify.ts';
import { log } from '../logging.ts';
import { TROUBLE_CLOCK_MS } from '../phases/phases.ts';
import * as schema from '../db/schema.ts';
import { game, mistake, movePly, patternState } from '../db/schema.ts';

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

/**
 * Analysed games in the stream played since `since`, the same filter
 * `measureFocusStream` applies: complete analysis, a played date, and - for
 * the online stream - a blitz time control only.
 */
export async function windowCount(
  db: Db,
  playerId: string,
  stream: (typeof schema.streamEnum.enumValues)[number],
  since: Date,
): Promise<number> {
  const scope = and(
    eq(game.playerId, playerId),
    eq(game.stream, stream),
    eq(game.analysisStatus, 'complete'),
    isNotNull(game.playedAt),
    gte(game.playedAt, since),
  );
  if (stream === 'tournament') {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(game)
      .where(scope);
    return row?.n ?? 0;
  }
  const rows = await db.select({ timeControl: game.timeControl }).from(game).where(scope);
  return rows.filter((r) => classifyTimeControl(r.timeControl) === 'blitz').length;
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
            .set({ state: 'came_back', cameBackAt: new Date(), lastAlertGameId: gameId })
            .where(eq(patternState.id, row.id));
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
        const count = await windowCount(db, g.playerId, g.stream, row.masteredAt);
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

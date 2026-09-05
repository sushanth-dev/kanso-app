/**
 * ST-123. How consistently the player follows their own opening lines.
 *
 * Per opening group (ECO), the modal first-ten-ply line over the group's
 * tournament games, and the share of those games whose first ten plies match
 * it. The moves are the rows the import already wrote to `move_ply` - no
 * engine call, no new analysis. The computation rides the report read (it is
 * re-computed per read, like the evidence) and only ever runs on the
 * tournament stream per F12's partition: online games never enter, and the
 * figure never appears on an online card.
 *
 * Like `opening-leaks.ts`, the split is deliberate: {@link modalLineConsistency}
 * is the pure scoring - testable with no database, with the floor and the
 * window as exported constants so they cannot drift silently (AC 5) - and
 * {@link lineConsistencyByEco} is the one Drizzle query that feeds it.
 *
 * The denominator is every game in the group in scope, whatever its length or
 * analysis state: a game that ends before ply ten has not played the line for
 * ten plies, so it counts and cannot match. A group where no game reaches the
 * window has no modal line at all, which is its own honest refusal rather
 * than a zero.
 */
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import { game, movePly } from '../db/schema.ts';

type Db = PostgresJsDatabase<typeof schema>;
type Stream = (typeof schema.streamEnum.enumValues)[number];

/** A group shows no consistency number until the stream holds at least this many games in it. */
export const CONSISTENCY_MIN_GAMES = 5;

/** The line is the game's first ten plies, full stop. */
export const CONSISTENCY_WINDOW_PLIES = 10;

/** One opening group's consistency, as the wire carries it. */
export type LineConsistency =
  | { status: 'ok'; matched: number; games: number }
  | { status: 'below_floor'; games: number }
  | { status: 'no_full_line'; games: number };

/**
 * The modal line and the share that follows it. Pure: no database, no clock.
 *
 * `lines` is one entry per game in the group, each the game's stored SAN
 * moves (an empty array where no plies were stored). The modal line is the
 * most common first-ten-ply sequence among the games that reach the window;
 * a tie breaks to the lexicographically smaller line, so the same games
 * always yield the same line. The share is over every game, not only the
 * ones that reached the window.
 */
export function modalLineConsistency(lines: readonly (readonly string[])[]): LineConsistency {
  if (lines.length < CONSISTENCY_MIN_GAMES) {
    return { status: 'below_floor', games: lines.length };
  }

  const counts = new Map<string, number>();
  for (const line of lines) {
    if (line.length < CONSISTENCY_WINDOW_PLIES) continue;
    const window = line.slice(0, CONSISTENCY_WINDOW_PLIES).join(' ');
    counts.set(window, (counts.get(window) ?? 0) + 1);
  }
  if (counts.size === 0) return { status: 'no_full_line', games: lines.length };

  let modal = '';
  let best = 0;
  for (const [line, n] of counts) {
    if (n > best || (n === best && line < modal)) {
      modal = line;
      best = n;
    }
  }
  const matched = lines.filter(
    (line) => line.slice(0, CONSISTENCY_WINDOW_PLIES).join(' ') === modal,
  ).length;
  return { status: 'ok', matched, games: lines.length };
}

/**
 * The consistency per ECO for one player's tournament games in scope, one
 * query for every group on the report. Windowed like the rest of the card:
 * the same `windowStart` the report's evidence draws from, so the number and
 * the instances beside it describe the same season. Games whose analysis has
 * not run still count - the claim is about the moves the player made, and
 * the import stored those.
 */
export async function lineConsistencyByEco(
  db: Db,
  playerId: string,
  stream: Stream,
  windowStart: Date | null,
  tournamentId: string | undefined,
  ecos: readonly string[],
): Promise<Map<string, LineConsistency>> {
  if (ecos.length === 0) return new Map();

  const rows = await db
    .select({
      eco: game.eco,
      // Null for a game with no stored plies in the window (an empty line),
      // which counts in the denominator and cannot match.
      sans: sql<
        string[] | null
      >`array_agg(${movePly.san} order by ${movePly.ply}) filter (where ${movePly.id} is not null)`,
    })
    .from(game)
    .leftJoin(movePly, and(eq(movePly.gameId, game.id), lte(movePly.ply, CONSISTENCY_WINDOW_PLIES)))
    .where(
      and(
        eq(game.playerId, playerId),
        eq(game.stream, stream),
        windowStart === null ? undefined : gte(game.playedAt, windowStart),
        tournamentId === undefined ? undefined : eq(game.tournamentId, tournamentId),
        inArray(game.eco, ecos),
      ),
    )
    .groupBy(game.id, game.eco);

  const lines = new Map<string, (readonly string[])[]>();
  for (const row of rows) {
    if (row.eco === null) continue;
    const group = lines.get(row.eco) ?? [];
    group.push(row.sans ?? []);
    lines.set(row.eco, group);
  }
  return new Map([...lines].map(([eco, group]) => [eco, modalLineConsistency(group)]));
}

/**
 * ST-032 measurement task. Run the four focuses over the real games in the
 * database, per stream, and report the window sizes, the numbers produced, and
 * the refusals with their causes. This is the sprint's one question, answered
 * with a computation rather than an endpoint.
 *
 * Run with `npm run seed`'s sibling pattern:
 *   node --env-file-if-exists=../../.env --env-file-if-exists=../../.env.local \
 *     src/scripts/measure-focus.ts
 */
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../db/schema.ts';
import { game } from '../db/schema.ts';
import { FOCUS_COMPUTE } from '../focus/computations.ts';
import { FOCUS_SPECS, FOCUS_WINDOW_GAMES, splitWindow, trendFor } from '../focus/verify.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });
const db = drizzle(sql, { schema });

const PLAYER_NAME = process.argv[2] ?? 'Test Player';

try {
  const [player] = await db
    .select({ id: schema.player.id })
    .from(schema.player)
    .where(eq(schema.player.displayName, PLAYER_NAME))
    .limit(1);
  if (!player) {
    console.error(`No player named ${PLAYER_NAME}.`);
    process.exit(1);
  }

  // The focus started one month before the player's latest analysed game.
  const [latest] = await db
    .select({ at: game.playedAt })
    .from(game)
    .where(
      and(
        eq(game.playerId, player.id),
        eq(game.analysisStatus, 'complete'),
        isNotNull(game.playedAt),
      ),
    )
    .orderBy(desc(game.playedAt))
    .limit(1);
  const startedAt = new Date((latest?.at?.getTime() ?? Date.now()) - 30 * 24 * 60 * 60 * 1000);

  console.log(`player: ${PLAYER_NAME} (${player.id})`);
  console.log(`focus started: ${startedAt.toISOString()}`);

  for (const stream of ['tournament', 'online'] as const) {
    const games = await db
      .select({ id: game.id, playedAt: game.playedAt })
      .from(game)
      .where(
        and(
          eq(game.playerId, player.id),
          eq(game.stream, stream),
          eq(game.analysisStatus, 'complete'),
          isNotNull(game.playedAt),
        ),
      )
      .orderBy(desc(game.playedAt));

    const { baselineIds, currentIds } = splitWindow(startedAt, games);
    console.log(
      `\n${stream}: ${games.length} analysed games (baseline ${baselineIds.length}, current ${currentIds.length})`,
    );

    for (const key of Object.keys(FOCUS_SPECS)) {
      if (games.length === 0) {
        console.log(`  ${key}: refused (no analysed games)`);
        continue;
      }
      if (baselineIds.length < FOCUS_WINDOW_GAMES || currentIds.length < FOCUS_WINDOW_GAMES) {
        console.log(
          `  ${key}: refused (window floor ${FOCUS_WINDOW_GAMES}: baseline ${baselineIds.length}, current ${currentIds.length})`,
        );
        continue;
      }
      const compute = FOCUS_COMPUTE[key]!;
      const baselineValue = await compute(db, player.id, baselineIds);
      const currentValue = await compute(db, player.id, currentIds);
      const trend = trendFor(FOCUS_SPECS[key]!, baselineValue, currentValue);
      console.log(
        `  ${key}: ${trend} (baseline ${baselineValue}, current ${currentValue}, window ${FOCUS_WINDOW_GAMES})`,
      );
    }
  }
} finally {
  await sql.end();
}

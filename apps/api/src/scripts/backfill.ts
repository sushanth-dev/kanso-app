/**
 * The operator entry point for `runBackfill` (ST-016).
 *
 * Two modes, both guarded by the localhost check and never reachable over
 * HTTP:
 *
 *   node src/scripts/backfill.ts                 run the backfill, print counts
 *   node src/scripts/backfill.ts --reset <id>    null tournament_id and delete
 *                                                tournaments for one player
 *
 * The reset reconstructs the pre-ST-011 state the story needs: it undoes the
 * importer's attachment for exactly one player so the backfill can be run over
 * the same games and compared. It is scoped to that player, never every
 * player.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import { game, tournament } from '../db/schema.ts';
import { runBackfill } from '../tournaments/backfill.ts';
import { isLocalhostDatabaseUrl } from './localhost.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. See docs/guides/local-setup.md.');
  process.exit(1);
}
if (!isLocalhostDatabaseUrl(databaseUrl)) {
  console.error('Refusing to run: DATABASE_URL does not point at localhost.');
  process.exit(1);
}

const [mode, playerId] = process.argv.slice(2);

const sql = postgres(databaseUrl, { max: 1 });
const db = drizzle(sql, { schema });

try {
  if (mode === '--reset') {
    if (!playerId) {
      console.error('--reset needs a player id: node src/scripts/backfill.ts --reset <playerId>');
      process.exit(1);
    }
    const updated = await db
      .update(game)
      .set({ tournamentId: null })
      .where(eq(game.playerId, playerId))
      .returning({ id: game.id });
    const deleted = await db
      .delete(tournament)
      .where(eq(tournament.playerId, playerId))
      .returning({ id: tournament.id });
    console.log(
      `Reset player ${playerId}: nulled tournament_id on ${updated.length} games, deleted ${deleted.length} tournaments.`,
    );
  } else {
    const report = await runBackfill(db);
    console.log(`Tournaments created: ${report.tournamentsCreated}`);
    console.log(`Games attached: ${report.gamesAttached}`);
    const unattached = report.unattached.map((u) => `${u.reason}: ${u.count}`).join(', ') || 'none';
    console.log(`Unattached: ${unattached}`);
  }
} finally {
  await sql.end();
}

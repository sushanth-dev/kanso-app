/**
 * The dev-only seed (ST-016): load the nine real PGN fixtures into a local
 * database by calling the importer's write path directly.
 *
 * Operator-run and never reachable over HTTP. It refuses to run unless
 * `DATABASE_URL` points at localhost, imports for exactly one player, and never
 * queues analysis, so running it costs nothing and cannot touch anything but
 * its own rows. It prints the importer's counts so they can be compared with
 * the backfill's.
 */
import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { user } from '../db/auth-schema.ts';
import * as schema from '../db/schema.ts';
import { player } from '../db/schema.ts';
import { importGames } from '../import/import-games.ts';
import { parsePgn } from '../import/parse-pgn.ts';
import { isLocalhostDatabaseUrl } from './localhost.ts';

const FIXTURES = [
  'test.pgn',
  'test2.pgn',
  'test3.pgn',
  'test4.pgn',
  'test5.pgn',
  'test6.pgn',
  'test7.pgn',
  'test8.pgn',
  'test9.pgn',
] as const;

const DISPLAY_NAME = 'Test Player';
const OWNER_USER_ID = 'st016_seed_owner';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. See docs/guides/local-setup.md.');
  process.exit(1);
}
if (!isLocalhostDatabaseUrl(databaseUrl)) {
  console.error('Refusing to seed: DATABASE_URL does not point at localhost.');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });
const db = drizzle(sql, { schema });

try {
  await db
    .insert(user)
    .values({
      id: OWNER_USER_ID,
      name: 'ST-016 seed owner',
      email: 'st016-seed@example.com',
      emailVerified: true,
    })
    .onConflictDoNothing();

  const createdPlayer = (
    await db
      .insert(player)
      .values({ ownerUserId: OWNER_USER_ID, displayName: DISPLAY_NAME })
      .returning({ id: player.id })
  )[0]!;

  const fixturesDir = new URL('../import/fixtures/real/', import.meta.url);

  let gamesFound = 0;
  let gamesImported = 0;
  let gamesUndetermined = 0;
  const perFile: string[] = [];

  for (const name of FIXTURES) {
    const pgn = readFileSync(new URL(name, fixturesDir), 'utf8');
    const parsed = parsePgn(pgn);
    if (!parsed.ok) {
      console.error(
        `seed: ${name} could not be parsed: ${parsed.faults.map((f) => f.reason).join('; ')}`,
      );
      process.exit(1);
    }
    const result = await importGames(db, {
      playerId: createdPlayer.id,
      stream: 'tournament',
      displayName: DISPLAY_NAME,
      games: parsed.games,
    });
    gamesFound += result.job.gamesFound;
    gamesImported += result.job.gamesImported;
    gamesUndetermined += result.job.gamesUndetermined;
    perFile.push(
      `${name}: ${result.job.gamesImported} imported, ${result.job.gamesUndetermined} undetermined`,
    );
  }

  // The importer's tournament counts, read from the database it just wrote.
  // They come from the final state rather than from summing `attachGames`
  // outcomes, which recount the games a later file shares with an earlier one.
  const tournamentsCreated = (
    await sql<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM tournament WHERE player_id = ${createdPlayer.id}`
  )[0]!.count;
  const gamesAttached = (
    await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM game
    WHERE player_id = ${createdPlayer.id} AND stream = 'tournament' AND tournament_id IS NOT NULL`
  )[0]!.count;
  const gamesUnattached = (
    await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM game
    WHERE player_id = ${createdPlayer.id} AND stream = 'tournament' AND tournament_id IS NULL`
  )[0]!.count;

  console.log(`Seeded player ${createdPlayer.id} (${DISPLAY_NAME})`);
  console.log(`Games found: ${gamesFound}`);
  console.log(`Games imported: ${gamesImported}`);
  console.log(`Games undetermined (no player colour): ${gamesUndetermined}`);
  console.log(`Tournaments created: ${tournamentsCreated}`);
  console.log(`Games attached: ${gamesAttached}`);
  console.log(`Games unattached: ${gamesUnattached}`);
  for (const line of perFile) console.log(`  ${line}`);

  await sql.end();
} catch (error) {
  console.error(error);
  await sql.end();
  process.exit(1);
}

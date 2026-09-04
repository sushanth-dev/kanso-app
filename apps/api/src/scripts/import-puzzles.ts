/**
 * ST-106. Import the drill puzzle pool from the Lichess puzzle database.
 *
 * Operator-run, idempotent. It streams the dump's zstd-compressed CSV through
 * the system `zstd` binary, keeps rows that match the themes the weakness
 * mapping drills, inside a sane rating band with a quality floor, validates
 * every kept row against chess.js, and inserts them under their Lichess id, so
 * re-running against a newer dump adds without duplicating. Nothing in the
 * application writes to the `puzzle` table; this script and a re-import are
 * the only writers.
 *
 * Usage: npm run puzzles:import --workspace apps/api -- <path/to/lichess_db_puzzle.csv.zst>
 * Optional flags: --cap N (rows kept per theme, default 3000),
 * --min-rating/--max-rating (default 600/2400).
 *
 * The dump (https://database.lichess.org, CC0) is a monthly snapshot of about
 * 290 MB compressed and 6 million puzzles; the filter keeps a few tens of
 * thousands, so the run takes minutes and the database gains a pool the drill
 * assembler can guarantee 20 puzzles per mistake group from.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Chess } from 'chess.js';
import postgres from 'postgres';
import { puzzle } from '../db/schema.ts';

/** The theme slugs the ST-106 mapping drills. Anything else is dead weight. */
const IMPORT_THEMES: Record<string, true> = {
  hangingPiece: true,
  intermezzo: true,
  advantage: true,
  crushing: true,
  middlegame: true,
  endgame: true,
  opening: true,
};

/** Quality floor: puzzles rated this consistently by Lichess solvers. */
const MAX_RATING_DEVIATION = 100;
/** Community signal: weed the poorly regarded tail the vote data marks. */
const MIN_POPULARITY = 20;
const DEFAULT_CAP = 3000;
const INSERT_BATCH = 1000;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. See docs/guides/local-setup.md.');
  process.exit(1);
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const flags = new Map<string, string>();
const positional: string[] = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i]!.startsWith('--')) flags.set(args[i]!.slice(2), args[i + 1] ?? '');
  else positional.push(args[i]!);
}
const dumpPath = positional[0];
if (!dumpPath) {
  console.error(
    'Usage: npm run puzzles:import --workspace apps/api -- <lichess_db_puzzle.csv.zst>',
  );
  process.exit(1);
}
const cap = Number(flags.get('cap') ?? DEFAULT_CAP);
const minRating = Number(flags.get('min-rating') ?? 600);
const maxRating = Number(flags.get('max-rating') ?? 2400);

/**
 * One dump line parsed to the columns the pool stores, or null when the row
 * fails a filter. The dump has no quoted fields - FENs, theme lists and URLs
 * carry no commas - so a plain split is the honest parser, and the header
 * check below proves the assumption before any row trusts it.
 */
interface DumpRow {
  lichessId: string;
  fen: string;
  moves: string;
  rating: number;
  themes: string[];
  /** ST-122. The dump's deepest opening tag, null when the source game named none. */
  opening: string | null;
}

function parseLine(line: string): DumpRow | null {
  const columns = line.split(',');
  if (columns.length < 9) return null;
  const [lichessId, fen, moves, rating, deviation, popularity, , themes, , openingTags] = columns;
  if (!lichessId || !fen || !moves || themes === undefined) return null;
  const ratingValue = Number(rating);
  if (!Number.isFinite(ratingValue) || ratingValue < minRating || ratingValue > maxRating) {
    return null;
  }
  if (Number(deviation) > MAX_RATING_DEVIATION || Number(popularity) < MIN_POPULARITY) {
    return null;
  }
  const kept = themes.split(' ').filter((theme) => theme in IMPORT_THEMES);
  if (kept.length === 0) return null;
  const tags = openingTags === undefined || openingTags === '' ? null : openingTags.split(' ');
  return {
    lichessId,
    fen,
    moves,
    rating: ratingValue,
    themes: kept,
    opening: tags === null ? null : tags[tags.length - 1]!,
  };
}

/** A kept row must actually play: the dump is machine-generated, not sacred. */
function playsThrough(row: DumpRow): boolean {
  try {
    const chess = new Chess(row.fen);
    for (const uci of row.moves.split(' ')) {
      // A non-promotion move refuses a promotion field, so it is passed
      // through only when the dump's UCI carries the extra square.
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      if (uci.length > 4) chess.move({ from, to, promotion: uci.slice(4, 5) });
      else chess.move({ from, to });
    }
    return true;
  } catch {
    return false;
  }
}

const sql = postgres(databaseUrl, { max: 1 });
const db = drizzle(sql, { schema: { puzzle } });

const zstd = spawn('zstd', ['-dc', dumpPath], { stdio: ['ignore', 'pipe', 'inherit'] });
zstd.on('error', (error) => {
  console.error(`zstd failed to start (is it installed?): ${error.message}`);
  process.exit(1);
});
const lines = createInterface({ input: zstd.stdout, crlfDelay: Infinity });

const keptPerTheme = new Map<string, number>(Object.keys(IMPORT_THEMES).map((theme) => [theme, 0]));
const batch: DumpRow[] = [];
let seen = 0;
let rejected = 0;
let inserted = 0;

async function flush(): Promise<void> {
  if (batch.length === 0) return;
  const rows = batch.splice(0, batch.length);
  await db.insert(puzzle).values(rows).onConflictDoNothing({ target: puzzle.lichessId });
  inserted += rows.length;
}

try {
  for await (const line of lines) {
    if (seen === 0 && !line.startsWith('PuzzleId,')) {
      console.error('The dump does not start with the expected CSV header. Refusing.');
      process.exit(1);
    }
    seen += 1;
    if (seen === 1) continue;
    const row = parseLine(line);
    if (row === null) continue;
    // The cap check runs before the chess.js walk: every theme at cap can
    // skip millions of rows without validating them, which is the difference
    // between a minutes-long import and an hour-long one.
    if (!row.themes.some((theme) => (keptPerTheme.get(theme) ?? 0) < cap)) continue;
    if (!playsThrough(row)) {
      rejected += 1;
      continue;
    }
    // One counter per matched theme: a row entering through a rare theme
    // still fills the popular ones it carries, so no theme's cap is a lie.
    for (const theme of row.themes) {
      keptPerTheme.set(theme, (keptPerTheme.get(theme) ?? 0) + 1);
    }
    batch.push(row);
    if (batch.length >= INSERT_BATCH) await flush();
  }
  await flush();
} finally {
  zstd.kill();
  await sql.end();
}

console.log(`Lines read: ${seen - 1}`);
console.log(`Rows inserted: ${inserted} (chess.js rejections: ${rejected})`);
for (const [theme, count] of [...keptPerTheme].sort()) {
  console.log(`  ${theme}: ${count}`);
}

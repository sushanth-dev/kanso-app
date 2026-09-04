/**
 * ST-122. Generate the two artifacts the opening-matched drill needs, once:
 *
 *  1. `src/practice/eco-openings.ts` - each published ECO code mapped to the
 *     root-most live Lichess opening tag. Derived from
 *     lichess-org/chess-openings (public domain): every name that ECO covers
 *     is slugged the way Lichess spells tags (accents drop, hyphens stay),
 *     then the shortest live dump token in that family is the value. The
 *     drill's opening rungs prefix-match these slugs against the pool's
 *     `opening` column.
 *  2. `drizzle/0029_seed_puzzle_openings.sql` - the migration that adds the
 *     `opening` column and gives the seeded pool rows (0024) their tags from
 *     the Lichess puzzle dump (CC0).
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/generate-eco-map.ts \
 *     <lichess_db_puzzle.csv.zst> <apps/api/drizzle/0024_seed_puzzle_pool.sql> <chess-openings tsv dir>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const [dumpPath, seedPath, tsvDir] = process.argv.slice(2);
if (!dumpPath || !seedPath || !tsvDir) {
  console.error('Usage: generate-eco-map.ts <dump.csv.zst> <0024_seed_puzzle_pool.sql> <tsv-dir>');
  process.exit(1);
}

/**
 * Lichess tag slug of a chess-openings name: punctuation drops, including
 * accents - the dump spells Grunfeld and Reti bare - hyphens stay, spaces
 * become underscores.
 */
function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/['’.,()#!]/g, '')
    .replace(/:/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

// ─── 1. Every slug each ECO covers, from the chess-openings tables ─────────

const ecoCandidates = new Map<string, string[]>();
for (const letter of ['a', 'b', 'c', 'd', 'e']) {
  const lines = readFileSync(`${tsvDir}/${letter}.tsv`, 'utf8').split('\n');
  for (const line of lines.slice(1)) {
    const [eco, name] = line.split('\t');
    if (!eco || !name) continue;
    const slugs = ecoCandidates.get(eco) ?? [];
    const slug = slugify(name);
    if (!slugs.includes(slug)) slugs.push(slug);
    ecoCandidates.set(eco, slugs);
  }
}

// ─── 2. Stream the dump: the 0024 rows with tags, and the live tag universe ─

const seedIds = new Set<string>();
for (const line of readFileSync(seedPath, 'utf8').split('\n')) {
  const match = /^\('([^']+)',/.exec(line);
  if (match !== null) seedIds.add(match[1]!);
}
if (seedIds.size === 0) {
  console.error('The 0024 seed produced no ids. Wrong file?');
  process.exit(1);
}

interface PoolRow {
  lichessId: string;
  fen: string;
  moves: string;
  rating: number;
  themes: string[];
  opening: string | null;
}
const poolRows = new Map<string, PoolRow>();
const liveTags = new Set<string>();

const zstd = spawn('zstd', ['-dc', dumpPath], { stdio: ['ignore', 'pipe', 'inherit'] });
zstd.on('error', (error) => {
  console.error(`zstd failed to start (is it installed?): ${error.message}`);
  process.exit(1);
});
const lines = createInterface({ input: zstd.stdout, crlfDelay: Infinity });

let seen = 0;
try {
  for await (const line of lines) {
    if (seen === 0 && !line.startsWith('PuzzleId,')) {
      console.error('The dump does not start with the expected CSV header. Refusing.');
      process.exit(1);
    }
    seen += 1;
    if (seen === 1) continue;
    const columns = line.split(',');
    const [id, fen, moves, rating, , , , themes, , openingTags] = columns;
    if (id === undefined || fen === undefined || moves === undefined) continue;
    if (openingTags !== undefined && openingTags !== '') {
      const tokens = openingTags.split(' ');
      liveTags.add(tokens[tokens.length - 1]!);
    }
    if (!seedIds.has(id)) continue;
    const tags = openingTags === undefined || openingTags === '' ? null : openingTags.split(' ');
    poolRows.set(id, {
      lichessId: id,
      fen,
      moves,
      rating: Number(rating),
      themes: themes === undefined ? [] : themes.split(' '),
      // The deepest token, so a family prefix matches it and every variation.
      opening: tags === null ? null : tags[tags.length - 1]!,
    });
  }
} finally {
  zstd.kill();
}

// ─── 3. The story's stop-and-ask note: every seeded id must survive ─────────

const missing = [...seedIds].filter((id) => !poolRows.has(id));
if (missing.length > 0) {
  console.error(
    `The current dump is missing ${missing.length} of the 0024 ids (regenerated away?). ` +
      `First few: ${missing.slice(0, 5).join(', ')}. Stop and ask.`,
  );
  process.exit(1);
}

// ─── 4. Per ECO: the shortest live tag its family reaches ───────────────────

const ecoOpenings = new Map<string, string>();
const uncovered: string[] = [];
for (const [eco, candidates] of ecoCandidates) {
  // The root-most candidate a live tag extends: the value itself need not
  // appear in the dump - a family prefix reaches every descendant it has -
  // but at least one descendant must, or the rung could never fire.
  const reaching = candidates
    .filter((candidate) =>
      [...liveTags].some((tag) => tag.startsWith(candidate) || candidate.startsWith(tag)),
    )
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  if (reaching.length > 0) ecoOpenings.set(eco, reaching[0]!);
  else {
    // No live tag reaches this ECO's family: keep the shortest candidate so
    // the rung exists and can fire if a future dump grows the family.
    const fallback = [...candidates].sort((a, b) => a.length - b.length || a.localeCompare(b))[0]!;
    ecoOpenings.set(eco, fallback);
    uncovered.push(`${eco}=${fallback}`);
  }
}

// ─── 5. Emit the migration ──────────────────────────────────────────────────

const q = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const rowSql = (row: PoolRow): string =>
  `(${q(row.lichessId)}, ${q(row.fen)}, ${q(row.moves)}, ${row.rating}, ` +
  `ARRAY[${row.themes.map(q).join(',')}], ${row.opening === null ? 'NULL' : q(row.opening)})`;

const migration = `-- ST-122. Give the seeded pool its opening tags, the column the drill's
-- opening rungs match. Same dump and import as 0024 (CC0), read again for the
-- OpeningTags column the first seed left out. This runs in the Migrate
-- Lambda, which is the only path into the production database. Idempotent on
-- lichess_id, and the conflict path writes only the new column, so recorded
-- attempts survive the re-seed untouched.

ALTER TABLE "puzzle" ADD COLUMN "opening" text;

INSERT INTO "puzzle" ("lichess_id", "fen", "moves", "rating", "themes", "opening") VALUES
${[...poolRows.values()].map(rowSql).join(',\n')}
ON CONFLICT ("lichess_id") DO UPDATE SET "opening" = EXCLUDED."opening";
`;

// ─── 6. Emit the map ────────────────────────────────────────────────────────

const entries = [...ecoOpenings.entries()].sort(([a], [b]) => a.localeCompare(b));

const mapSource = `/**
 * ST-122. Each published ECO code's root-most live Lichess opening tag,
 * generated from lichess-org/chess-openings (public domain) by
 * \`scripts/generate-eco-map.ts\`. Every name the ECO covers is slugged the
 * way Lichess spells tags, and the shortest live dump token in that family
 * is the value, so the drill's opening rungs prefix-match tags the pool
 * actually carries; an ECO absent here, or whose family the pool does not
 * carry, falls through to the theme rungs. Regenerate, do not hand-edit.
 */
export const ECO_OPENINGS: Record<string, string> = {
${entries.map(([eco, slug]) => `  ${q(eco)}: ${q(slug)},`).join('\n')}
};
`;

writeFileSync(new URL('../../drizzle/0029_seed_puzzle_openings.sql', import.meta.url), migration);
writeFileSync(new URL('../practice/eco-openings.ts', import.meta.url), mapSource);

console.log(`ECO codes mapped: ${entries.length}`);
console.log(
  `Seeded rows re-read with openings: ${poolRows.size} ` +
    `(opening set: ${[...poolRows.values()].filter((row) => row.opening !== null).length})`,
);
console.log(`Live dump tag tokens: ${liveTags.size}`);
console.log(
  `ECO slugs no live tag reaches: ${uncovered.length}` +
    (uncovered.length > 0 ? ` -> ${uncovered.slice(0, 8).join(', ')}` : ''),
);

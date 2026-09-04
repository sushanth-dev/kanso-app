/**
 * The engine driver, against a scripted engine instead of Stockfish.
 *
 * The real search is covered by `engine.integration.test.ts`; this file pins
 * the driver's own contract at unit speed by speaking UCI with a fake engine
 * child process written to a temp directory. The fake encodes its answer in
 * the FEN it receives (the fields after the piece placement are free text to
 * `engine.ts`), so each test picks the score, bound markers, and bestmove the
 * engine "reports":
 *
 * - halfmove clock field -> the reported cp (or mate distance)
 * - en-passant field `m` -> report a mate score instead of cp
 * - castling field `n` -> `bestmove (none)`
 * - castling field `x` -> emit no score line at all
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluatePositions, type EngineOptions } from './engine.ts';

const FAKE_ENGINE = `let lastFen = '';
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf(String.fromCharCode(10))) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    handle(line);
  }
});
function out(line) { process.stdout.write(line + String.fromCharCode(10)); }
function handle(line) {
  if (line === 'uci') { out('id name fake'); out('uciok'); return; }
  if (line === 'isready') { out('readyok'); return; }
  if (line.startsWith('setoption')) return;
  if (line.startsWith('position fen ')) { lastFen = line.slice(13); return; }
  if (line.startsWith('go')) {
    const f = lastFen.split(' ');
    if (f[2] !== 'x') {
      const score = f[3] === 'm' ? 'mate ' + f[4] : 'cp ' + f[4];
      out('info depth 9 score cp 9999 nodes 1 lowerbound');
      out('info depth 8 score ' + score + ' nodes 500');
    }
    out(f[2] === 'n' ? 'bestmove (none)' : 'bestmove a1a8');
  }
}
`;

const DIE_ON_START = `process.exit(1);`;

let dir: string;
let fakeEnginePath: string;
let diesPath: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'engine-driver-'));
  fakeEnginePath = join(dir, 'fake-engine.js');
  diesPath = join(dir, 'dies.js');
  writeFileSync(fakeEnginePath, FAKE_ENGINE);
  writeFileSync(diesPath, DIE_ON_START);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function options(engines: number): EngineOptions {
  return { enginePath: fakeEnginePath, depth: 8, nodeCeiling: 1_000_000, engines, hashMb: 16 };
}

const fenWith = (turn: 'w' | 'b', castling = '-', ep = '-', halfmove = 350): string =>
  `4k3/8/8/8/8/8/8/4K3 ${turn} ${castling} ${ep} ${halfmove} 60`;

describe('evaluatePositions', () => {
  test('parses the deepest full score, skipping bound markers', async () => {
    // The lowerbound line carries cp 9999 at depth 9; the driver must take
    // the full score behind it, not the aspiration artefact.
    const [result] = await evaluatePositions([fenWith('w')], options(1));
    expect(result!.score).toEqual({ cp: 350 });
    expect(result!.bestMoveUci).toBe('a1a8');
    expect(result!.depth).toBe(8);
    expect(result!.nodes).toBe(500);
  });

  test('stores scores white-absolute, so black to move flips the sign', async () => {
    const [white, black] = await evaluatePositions([fenWith('w'), fenWith('b')], options(2));
    expect(white!.score.cp).toBe(350);
    expect(black!.score.cp).toBe(-350);
  });

  test('reports mate scores signed by side to move, with no centipawns', async () => {
    const [white, black] = await evaluatePositions(
      [fenWith('w', '-', 'm', 2), fenWith('b', '-', 'm', 2)],
      options(2),
    );
    expect(white!.score).toEqual({ mate: 2 });
    expect(black!.score).toEqual({ mate: -2 });
  });

  test('a finished position reports null for the best move', async () => {
    const [result] = await evaluatePositions([fenWith('w', 'n')], options(1));
    expect(result!.bestMoveUci).toBeNull();
    expect(result!.score.cp).toBe(350);
  });

  test('a search with no score is an error naming the position', async () => {
    await expect(evaluatePositions([fenWith('w', 'x')], options(1))).rejects.toThrow(
      /no evaluation/,
    );
  });

  test('returns results in input order however they are dealt across engines', async () => {
    const fens = Array.from({ length: 6 }, (_, i) =>
      fenWith(i % 2 === 0 ? 'w' : 'b', '-', '-', 100 + i),
    );
    const results = await evaluatePositions(fens, options(3));
    expect(results.map((r) => r.fen)).toEqual(fens);
    results.forEach((result, i) => {
      expect(result.score.cp).toBe(i % 2 === 0 ? 100 + i : -(100 + i));
    });
  });

  test('evaluates nothing without starting an engine', async () => {
    await expect(evaluatePositions([], options(4))).resolves.toEqual([]);
  });

  test('refuses a position that could carry a second command into the conversation', async () => {
    await expect(evaluatePositions([`${fenWith('w')}\ngo infinite`], options(1))).rejects.toThrow(
      /plain FEN/,
    );
  });

  test('a dead engine rejects the evaluation instead of hanging it', async () => {
    await expect(
      evaluatePositions([fenWith('w')], { ...options(1), enginePath: diesPath }),
    ).rejects.toThrow(/engine exited early/);
  });
});

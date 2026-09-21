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
 * - en-passant field `s` -> answer the handshake, then say nothing to `go`
 * - castling field `n` -> `bestmove (none)`
 * - castling field `x` -> emit no score line at all
 *
 * The fake also writes to its own directory, because two of the cases are about
 * what happens to the process rather than what it says: `boot-N.claim` records
 * which launch this is (created exclusively, so two engines starting at once
 * cannot claim the same number), `die-on-boot.txt` makes the named boot exit
 * instead of handshaking, and `stopped.txt` collects one line per launch that
 * caught a `SIGTERM`, which is how a test proves a process was stopped rather
 * than proving we asked.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluatePositions, type EngineOptions } from './engine.ts';

const FAKE_ENGINE = `(async () => {
const fs = await import('node:fs');
const path = await import('node:path');
const dir = path.dirname(process.argv[1]);

let boot = 0;
for (let i = 1; i <= 16 && boot === 0; i += 1) {
  try { fs.closeSync(fs.openSync(path.join(dir, 'boot-' + i + '.claim'), 'wx')); boot = i; } catch {}
}
let dieOn = 0;
try { dieOn = Number(fs.readFileSync(path.join(dir, 'die-on-boot.txt'), 'utf8')) || 0; } catch {}
if (dieOn !== 0 && boot === dieOn) process.exit(1);
process.on('SIGTERM', () => {
  fs.appendFileSync(path.join(dir, 'stopped.txt'), boot + String.fromCharCode(10));
  process.exit(0);
});

let lastFen = '';
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
    if (f[3] === 's') return;
    if (f[2] !== 'x') {
      const score = f[3] === 'm' ? 'mate ' + f[4] : 'cp ' + f[4];
      out('info depth 9 score cp 9999 nodes 1 lowerbound');
      out('info depth 8 score ' + score + ' nodes 500');
    }
    out(f[2] === 'n' ? 'bestmove (none)' : 'bestmove a1a8');
  }
}
})();
`;

const DIE_ON_START = `process.exit(1);`;

let dir: string;
let fakeEnginePath: string;
let diesPath: string;
const created: string[] = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'engine-driver-'));
  fakeEnginePath = join(dir, 'fake-engine.js');
  diesPath = join(dir, 'dies.js');
  writeFileSync(fakeEnginePath, FAKE_ENGINE);
  writeFileSync(diesPath, DIE_ON_START);
});

afterAll(() => {
  for (const path of [dir, ...created]) rmSync(path, { recursive: true, force: true });
});

function options(engines: number): EngineOptions {
  return { enginePath: fakeEnginePath, depth: 8, nodeCeiling: 1_000_000, engines, hashMb: 16 };
}

/**
 * A fake engine in a directory of its own, so the boot files start empty and
 * one case's launch numbering cannot leak into the next.
 */
function freshEngine(): { enginePath: string; stoppedPath: string; dieOnPath: string } {
  const bootDir = mkdtempSync(join(tmpdir(), 'engine-boot-'));
  created.push(bootDir);
  const enginePath = join(bootDir, 'fake-engine.js');
  writeFileSync(enginePath, FAKE_ENGINE);
  return {
    enginePath,
    stoppedPath: join(bootDir, 'stopped.txt'),
    dieOnPath: join(bootDir, 'die-on-boot.txt'),
  };
}

/**
 * A stop is a signal, so the marker lands some milliseconds after the call that
 * sent it.
 */
async function stoppedLaunches(file: string): Promise<string> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      if (Date.now() > deadline) throw new Error(`${file} was never written`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
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

  test('a search that stops answering rejects on its own deadline, and its process goes', async () => {
    const { enginePath, stoppedPath } = freshEngine();
    const silent = fenWith('w', '-', 's');
    const startedAt = Date.now();

    const failure = await evaluatePositions([silent], {
      ...options(1),
      enginePath,
      timeouts: { searchMs: 1_000 },
    }).then(
      () => null,
      (err: Error) => err,
    );

    // The command, the deadline in seconds, and the position: the wedged engine
    // is the cause, and a bare timeout would hide that.
    expect(failure?.message).toContain('did not answer "go depth 8 nodes 1000000" within 1s');
    expect(failure?.message).toContain(silent);
    // The harness's own timeout is the failure this replaces.
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(await stoppedLaunches(stoppedPath)).toBe('1\n');
  });

  test('a start that fails stops the engines that did start', async () => {
    const { enginePath, stoppedPath, dieOnPath } = freshEngine();
    writeFileSync(dieOnPath, '2');

    await expect(
      evaluatePositions([fenWith('w'), fenWith('b')], { ...options(2), enginePath }),
    ).rejects.toThrow(/engine exited early/);

    // Written by the first engine's own SIGTERM handler, so this asserts a
    // process that stopped rather than a call we made.
    expect(await stoppedLaunches(stoppedPath)).toBe('1\n');
  });
});

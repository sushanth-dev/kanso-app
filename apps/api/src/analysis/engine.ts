/**
 * Stockfish over UCI, as child processes.
 *
 * ADR-0023 settles the shape and this file implements it. Three things here are
 * findings rather than choices, each measured while writing that record:
 *
 * 1. One engine per child process. The `stockfish` npm package can only be
 *    initialised once per process, and inside a `worker_threads` worker it
 *    fails outright because it mistakes a Node worker for one of its own
 *    pthreads. A child process has neither problem, and it is also how the
 *    native binary has to be run, so both engines take one code path.
 * 2. Positions are split across several single-threaded engines rather than
 *    given to one multi-threaded engine. At a fixed budget the threaded build
 *    reaches a shallower depth for the same work, which is a quality cut
 *    wearing a speedup's clothes.
 * 3. The evaluation is read off the deepest `info` line that carries a score,
 *    skipping `lowerbound` and `upperbound` lines, which are aspiration-window
 *    artefacts and not evaluations.
 *
 * Security (ST-007's assessment): the engine is spawned with an argument array
 * and never through a shell, and positions are written to its stdin as UCI
 * tokens. A FEN containing a newline would still be able to append a command to
 * the conversation, so it is rejected at the boundary rather than trusted to
 * have come from chess.js.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { EvalScore } from '../chess/lichess-utils.ts';

export interface EngineOptions {
  /**
   * The engine to run. A path ending in `.js` is the WebAssembly build and is
   * run with this Node binary; anything else is a native executable. The two
   * were measured to search identically at a fixed depth, to the node, which is
   * what lets the tests run one and production run the other.
   */
  enginePath: string;
  /** Minimum depth per position. The contract. */
  depth: number;
  /** Nodes per position before the search gives up early. The safety rail. */
  nodeCeiling: number;
  /** How many engine processes to run at once. */
  engines: number;
  /** Transposition table size per engine process. */
  hashMb: number;
}

export interface EvaluatedPosition {
  fen: string;
  /** White-absolute, the perspective `lichess-utils.ts` and the schema use. */
  score: EvalScore;
  /** What the engine would have played here. Null in a finished position. */
  bestMoveUci: string | null;
  /** Reached, not requested. Below `options.depth` means the ceiling stopped it. */
  depth: number;
  nodes: number;
}

/** A FEN may not carry a newline into the UCI conversation. */
const SAFE_FEN = /^[A-Za-z0-9/ \-+#]+$/;

/** stderr is `ignore`d: the engine's own diagnostics are not our log. */
type EngineProcess = ChildProcessByStdio<Writable, Readable, null>;

class Engine {
  // Fields and an assigning constructor rather than parameter properties: Node
  // runs this file by stripping types, and stripping cannot rewrite a parameter
  // property into an assignment.
  private readonly proc: EngineProcess;
  private readonly listeners: ((line: string) => void)[];
  private readonly failure: () => Error | null;

  private constructor(
    proc: EngineProcess,
    listeners: ((line: string) => void)[],
    failure: () => Error | null,
  ) {
    this.proc = proc;
    this.listeners = listeners;
    this.failure = failure;
  }

  static async start(options: EngineOptions): Promise<Engine> {
    const isWasm = options.enginePath.endsWith('.js');
    const proc = isWasm
      ? spawn(process.execPath, [options.enginePath], { stdio: ['pipe', 'pipe', 'ignore'] })
      : spawn(options.enginePath, [], { stdio: ['pipe', 'pipe', 'ignore'] });

    const listeners: ((line: string) => void)[] = [];
    createInterface({ input: proc.stdout }).on('line', (line) => {
      const trimmed = line.trim();
      for (const fn of listeners.slice()) fn(trimmed);
    });

    // A dead engine must reject the promise waiting on it rather than leave it
    // pending forever, which is what turns a crashed subprocess into a hung
    // invocation and then a timeout nobody can explain.
    let failure: Error | null = null;
    const die = (why: string) => {
      failure = new Error(why);
      for (const fn of listeners.slice()) fn('');
    };
    proc.on('error', (err) => die(`engine failed to start: ${err.message}`));
    proc.on('exit', (code, signal) =>
      die(`engine exited early (code ${code ?? 'null'}, signal ${signal ?? 'none'})`),
    );

    const engine = new Engine(proc, listeners, () => failure);
    await engine.send('uci', (l) => l === 'uciok');
    engine.write(`setoption name Threads value 1`);
    engine.write(`setoption name Hash value ${options.hashMb}`);
    await engine.send('isready', (l) => l === 'readyok');
    return engine;
  }

  private write(command: string): void {
    this.proc.stdin.write(command + '\n');
  }

  private send(command: string, until: (line: string) => boolean): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const lines: string[] = [];
      const listener = (line: string) => {
        const failed = this.failure();
        if (failed !== null) {
          this.listeners.splice(this.listeners.indexOf(listener), 1);
          reject(failed);
          return;
        }
        lines.push(line);
        if (until(line)) {
          this.listeners.splice(this.listeners.indexOf(listener), 1);
          resolve(lines);
        }
      };
      this.listeners.push(listener);
      this.write(command);
    });
  }

  async evaluate(fen: string, options: EngineOptions): Promise<EvaluatedPosition> {
    if (!SAFE_FEN.test(fen)) {
      throw new Error('refusing to send a position that is not a plain FEN to the engine');
    }
    this.write(`position fen ${fen}`);
    await this.send('isready', (l) => l === 'readyok');
    const lines = await this.send(`go depth ${options.depth} nodes ${options.nodeCeiling}`, (l) =>
      l.startsWith('bestmove'),
    );
    return readSearch(fen, lines);
  }

  stop(): void {
    this.proc.kill();
  }
}

/**
 * The deepest `info` line carrying a score, and the move the engine chose.
 *
 * Scores arrive from the side to move's perspective and are stored
 * white-absolute, so a position with Black to move has its sign flipped. Get
 * this wrong and every mistake for one colour inverts, which is the most
 * likely bug in this file and the reason the integration test asserts the same
 * material from both sides.
 */
function readSearch(fen: string, lines: string[]): EvaluatedPosition {
  let best: string | null = null;
  for (const line of lines) {
    if (!line.startsWith('info ') || !line.includes(' score ')) continue;
    if (line.includes('lowerbound') || line.includes('upperbound')) continue;
    best = line;
  }
  if (best === null) {
    throw new Error(`engine returned no evaluation for ${fen}`);
  }

  const blackToMove = fen.split(' ')[1] === 'b';
  const sign = blackToMove ? -1 : 1;
  const cp = /score cp (-?\d+)/.exec(best);
  const mate = /score mate (-?\d+)/.exec(best);
  const depth = /\bdepth (\d+)/.exec(best);
  const nodes = /\bnodes (\d+)/.exec(best);

  const bestMove = lines.at(-1)?.split(' ')[1];

  return {
    fen,
    score: {
      ...(cp === null ? {} : { cp: sign * Number(cp[1]) }),
      ...(mate === null ? {} : { mate: sign * Number(mate[1]) }),
    },
    bestMoveUci: bestMove === undefined || bestMove === '(none)' ? null : bestMove,
    depth: depth === null ? 0 : Number(depth[1]),
    nodes: nodes === null ? 0 : Number(nodes[1]),
  };
}

/**
 * Evaluate every position, across `options.engines` processes, in input order.
 *
 * Booting an engine costs 0.4 seconds, measured, so a fresh set per call is not
 * worth engineering around. Every process is killed on the way out, including
 * when a position throws, because four abandoned engines on a Lambda are four
 * engines still burning the CPU the next position needs.
 */
export async function evaluatePositions(
  fens: string[],
  options: EngineOptions,
): Promise<EvaluatedPosition[]> {
  if (fens.length === 0) return [];

  const count = Math.max(1, Math.min(options.engines, fens.length));
  const engines = await Promise.all(Array.from({ length: count }, () => Engine.start(options)));
  const results = new Array<EvaluatedPosition>(fens.length);

  try {
    await Promise.all(
      engines.map(async (engine, offset) => {
        for (let i = offset; i < fens.length; i += count) {
          results[i] = await engine.evaluate(fens[i], options);
        }
      }),
    );
  } finally {
    for (const engine of engines) engine.stop();
  }

  return results;
}

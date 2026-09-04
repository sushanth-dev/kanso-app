/**
 * The Lambda entry point, with the worker (`analyseGame`) mocked out.
 *
 * What is pinned here is the seam the queue talks through: one record per
 * game, the body as the game id, the budget's engine options handed to the
 * worker unchanged, and the failure contract SQS depends on — the error is
 * always rethrown, so the message comes back for retry or redrive. The
 * mid-attempt retry branch also writes to the database and is covered by the
 * queue's integration tests, not here.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  // handler.ts builds its database pool at module scope; postgres.js connects
  // lazily, so a URL that refuses is enough to import it without a database.
  process.env.DATABASE_URL ??= 'postgres://127.0.0.1:1/none';
  process.env.ENGINE_PATH ??= '/opt/engine/bin';
  process.env.ANALYSIS_MAX_ATTEMPTS ??= '3';
});

vi.mock('./analyse-game.ts', () => ({ analyseGame: vi.fn() }));

import { analyseGame } from './analyse-game.ts';
import { handler, type SqsEvent } from './handler.ts';
import {
  ANALYSIS_DEPTH,
  ANALYSIS_ENGINES,
  ANALYSIS_HASH_MB,
  ANALYSIS_NODE_CEILING,
} from './budget.ts';

const analyseGameMock = vi.mocked(analyseGame);

const record = (body: string, attempt = '1'): SqsEvent['Records'][number] => ({
  body,
  attributes: { ApproximateReceiveCount: attempt },
  messageAttributes: { requestId: { stringValue: 'req-1' } },
});

beforeEach(() => {
  analyseGameMock.mockReset();
});

describe('handler', () => {
  test('an event with no records touches no game', async () => {
    await expect(handler({ Records: [] })).resolves.toBeUndefined();
    expect(analyseGameMock).not.toHaveBeenCalled();
  });

  test('hands the queue body to the worker as the game id, with the budget’s options', async () => {
    analyseGameMock.mockResolvedValue({
      status: 'complete',
      plies: 60,
      mistakes: 3,
      nodes: 1_000_000,
      durationMs: 30_000,
      costMicros: 1_250,
    });

    await handler({ Records: [record('game-1', '2')] });

    expect(analyseGameMock).toHaveBeenCalledTimes(1);
    const [, gameId, options] = analyseGameMock.mock.calls[0]!;
    expect(gameId).toBe('game-1');
    expect(options).toEqual({
      enginePath: '/opt/engine/bin',
      depth: ANALYSIS_DEPTH,
      nodeCeiling: ANALYSIS_NODE_CEILING,
      engines: ANALYSIS_ENGINES,
      hashMb: ANALYSIS_HASH_MB,
    });
  });

  test('a record without attributes is a first attempt, without a request id', async () => {
    analyseGameMock.mockResolvedValue({
      status: 'complete',
      plies: 0,
      mistakes: 0,
      nodes: 0,
      durationMs: 0,
      costMicros: 0,
    });

    await handler({ Records: [{ body: 'game-1' }] });

    const [, gameId] = analyseGameMock.mock.calls[0]!;
    expect(gameId).toBe('game-1');
  });

  test('the request id rides through as the message attribute, when present', async () => {
    analyseGameMock.mockResolvedValue({
      status: 'complete',
      plies: 0,
      mistakes: 0,
      nodes: 0,
      durationMs: 0,
      costMicros: 0,
    });

    await handler({
      Records: [{ body: 'game-1', messageAttributes: { requestId: { stringValue: 'req-9' } } }],
    });
    expect(analyseGameMock).toHaveBeenCalledTimes(1);
  });

  test('processes every record in the batch', async () => {
    analyseGameMock.mockResolvedValue({
      status: 'complete',
      plies: 60,
      mistakes: 0,
      nodes: 0,
      durationMs: 1,
      costMicros: 0,
    });

    await handler({ Records: [record('game-1'), record('game-2')] });

    expect(analyseGameMock.mock.calls.map(([, id]) => id)).toEqual(['game-1', 'game-2']);
  });

  test('a failure is rethrown, so SQS decides between retry and redrive', async () => {
    // Last attempt under the default redrive policy (3): the failure is final.
    analyseGameMock.mockRejectedValue(new Error('engine blew up'));

    await expect(handler({ Records: [record('game-1', '3')] })).rejects.toThrow('engine blew up');
    expect(analyseGameMock).toHaveBeenCalledTimes(1);
  });
});

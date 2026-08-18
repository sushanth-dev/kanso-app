import { afterEach, describe, expect, test, vi } from 'vitest';
import { log } from './logging.ts';

describe('log', () => {
  const originalInfo = console.info;
  const originalError = console.error;

  afterEach(() => {
    console.info = originalInfo;
    console.error = originalError;
  });

  test('emits one JSON line with level, event, and fields', () => {
    const info = vi.fn();
    console.info = info;

    log('info', 'game_analysed', { requestId: 'req-1', gameId: 'g-1' });

    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(info.mock.calls[0]![0] as string)).toEqual({
      level: 'info',
      event: 'game_analysed',
      requestId: 'req-1',
      gameId: 'g-1',
    });
  });

  test('routes error to console.error', () => {
    const error = vi.fn();
    console.error = error;

    log('error', 'analysis_failed', { gameId: 'g-1' });

    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.parse(error.mock.calls[0]![0] as string)).toMatchObject({
      event: 'analysis_failed',
    });
  });
});

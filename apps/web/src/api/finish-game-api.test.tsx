import { describe, expect, test } from 'vitest';
import { ApiRequestError } from './account-api.ts';
import { createFinishGameApi } from './finish-game-api.ts';

const gameId = '00000000-0000-4000-8000-0000000000b1';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('finish-game API transport', () => {
  test('asks the engine-reply endpoint with credentials and the body', async () => {
    let lastRequest: Request | undefined;
    let lastBody: string | undefined;
    const api = createFinishGameApi(async (input) => {
      lastRequest = input as Request;
      lastBody = await lastRequest.text();
      return jsonResponse({
        status: 'reply',
        move: { san: 'a3', uci: 'a2a3' },
        evaluation: { cp: 45, mate: null },
      });
    });

    const reply = await api.engineReply(gameId, { railPly: 3, playerMoves: ['Ne2'] });

    expect(reply).toEqual({
      status: 'reply',
      move: { san: 'a3', uci: 'a2a3' },
      evaluation: { cp: 45, mate: null },
    });
    expect(new URL(lastRequest?.url ?? 'about:blank').pathname).toBe(
      `/games/${gameId}/engine-reply`,
    );
    expect(lastRequest?.method).toBe('POST');
    expect(lastRequest?.credentials).toBe('include');
    expect(lastBody).toBe('{"railPly":3,"playerMoves":["Ne2"]}');
  });

  test('a game-over answer passes through untouched', async () => {
    const api = createFinishGameApi(() =>
      Promise.resolve(jsonResponse({ status: 'game_over', move: null, evaluation: null })),
    );

    expect(await api.engineReply(gameId, { railPly: 4, playerMoves: [] })).toEqual({
      status: 'game_over',
      move: null,
      evaluation: null,
    });
  });

  test('rejects with the endpoint error for a bad move', async () => {
    const api = createFinishGameApi(() =>
      Promise.resolve(jsonResponse({ code: 'bad_move', message: 'Illegal move.' }, 422)),
    );

    const reply = api.engineReply(gameId, { railPly: 3, playerMoves: ['e5'] });
    await expect(reply).rejects.toBeInstanceOf(ApiRequestError);
    await expect(reply).rejects.toMatchObject({ status: 422, code: 'bad_move' });
  });
});

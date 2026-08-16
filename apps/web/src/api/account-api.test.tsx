import { describe, expect, test } from 'vitest';
import { ApiRequestError, createAccountApi } from './account-api.ts';

const meFixture = {
  userId: 'user-1',
  email: 'player@example.com',
  name: 'Player',
  tier: 'free' as const,
  players: [],
};
const playerId = '00000000-0000-4000-8000-000000000001';
const playerFixture = {
  id: playerId,
  displayName: 'Mina',
  birthYear: 2013,
  fideId: null,
  fideRating: null,
  uscfId: null,
  uscfRating: null,
  chesscomUsername: null,
  lichessUsername: null,
  chesscomRating: null,
  lichessRating: null,
  createdAt: '2026-08-14T00:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('account API transport', () => {
  test('gets the signed-in account with cross-origin credentials', async () => {
    let lastRequest: Request | undefined;
    const api = createAccountApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse(meFixture));
    });

    expect(await api.getMe()).toEqual(meFixture);
    expect(lastRequest).toBeDefined();
    const requestUrl = new URL(lastRequest?.url ?? 'about:blank');
    expect(requestUrl.origin).toBe(window.location.origin);
    expect(requestUrl.pathname).toBe('/me');
    expect(lastRequest?.credentials).toBe('include');
  });

  test('creates a player without adding ownership fields', async () => {
    let lastRequest: Request | undefined;
    const api = createAccountApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse(playerFixture, 201));
    });

    expect(await api.createPlayer({ displayName: 'Mina', birthYear: 2013 })).toEqual(playerFixture);
    expect(lastRequest?.url).toMatch(/\/players$/);
    expect(lastRequest?.method).toBe('POST');
    const lastRequestBody: unknown = await lastRequest?.json();
    expect(lastRequestBody).toEqual({ displayName: 'Mina', birthYear: 2013 });
    expect(JSON.stringify(lastRequestBody)).not.toContain('owner');
  });

  test('throws a typed API error for a forbidden update', async () => {
    const forbiddenApi = createAccountApi(() =>
      Promise.resolve(jsonResponse({ code: 'forbidden', message: 'Not allowed.' }, 403)),
    );

    const update = forbiddenApi.updatePlayer(playerId, { displayName: 'Mina' });
    await expect(update).rejects.toBeInstanceOf(ApiRequestError);
    await expect(update).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
      issues: undefined,
      message: 'Not allowed.',
    });
  });
});

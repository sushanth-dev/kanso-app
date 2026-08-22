import { describe, expect, test } from 'vitest';
import { ApiRequestError, createAccountApi } from './account-api.ts';

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
  currentStreak: 0,
  xp: 0,
  level: 1,
  createdAt: '2026-08-14T00:00:00.000Z',
};

const meFixture = {
  userId: 'user-1',
  email: 'player@example.com',
  name: 'Player',
  tier: 'beginner' as const,
  player: playerFixture,
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

  test('updates the player without adding ownership fields', async () => {
    let lastRequest: Request | undefined;
    const api = createAccountApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse(playerFixture));
    });

    expect(await api.updateMe({ displayName: 'Mina', birthYear: 2013 })).toEqual(playerFixture);
    expect(lastRequest?.url).toMatch(/\/me$/);
    expect(lastRequest?.method).toBe('PATCH');
    const lastRequestBody: unknown = await lastRequest?.json();
    expect(lastRequestBody).toEqual({ displayName: 'Mina', birthYear: 2013 });
    expect(JSON.stringify(lastRequestBody)).not.toContain('owner');
  });

  test('throws a typed API error for a failed update', async () => {
    const failedApi = createAccountApi(() =>
      Promise.resolve(jsonResponse({ code: 'forbidden', message: 'Not allowed.' }, 403)),
    );

    const update = failedApi.updateMe({ displayName: 'Mina' });
    await expect(update).rejects.toBeInstanceOf(ApiRequestError);
    await expect(update).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
      issues: undefined,
      message: 'Not allowed.',
    });
  });
});

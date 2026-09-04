import { describe, expect, test } from 'vitest';
import { ApiRequestError } from './account-api.ts';
import { createFocusApi, type SetFocus } from './focus-api.ts';

const catalogueEntry = {
  catalogueKey: 'endgame-rook',
  title: 'Rook endgames',
  family: 'endgame',
};

const activeFocus = {
  id: 'focus-1',
  source: 'recommended' as const,
  catalogue: catalogueEntry,
  coachInstruction: null,
  unverified: false,
  pairedFocusId: null,
  startedAt: '2026-09-01T00:00:00.000Z',
  measurements: [],
  practice: { total: 5, solved: 2, groups: 1 },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('focus API transport', () => {
  test('lists the focus catalogue with cross-origin credentials', async () => {
    let lastRequest: Request | undefined;
    const api = createFocusApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse([catalogueEntry]));
    });

    expect(await api.listFocuses()).toEqual([catalogueEntry]);
    expect(new URL(lastRequest?.url ?? 'about:blank').pathname).toBe('/focuses');
    expect(lastRequest?.method).toBe('GET');
    expect(lastRequest?.credentials).toBe('include');
  });

  test('gets the active focus', async () => {
    let lastRequest: Request | undefined;
    const api = createFocusApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse(activeFocus));
    });

    expect(await api.getFocus()).toEqual(activeFocus);
    expect(new URL(lastRequest?.url ?? 'about:blank').pathname).toBe('/focus');
  });

  test('sets a recommended focus by catalogue key', async () => {
    let lastRequest: Request | undefined;
    const api = createFocusApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse(activeFocus));
    });

    const body: SetFocus = { source: 'recommended', catalogueKey: 'endgame-rook' };
    expect(await api.setFocus(body)).toEqual(activeFocus);
    expect(lastRequest?.method).toBe('PUT');
    expect(new URL(lastRequest?.url ?? 'about:blank').pathname).toBe('/focus');
    expect(await lastRequest?.json()).toEqual(body);
  });

  test('sets a coach focus with the instruction and paired key', async () => {
    let lastRequest: Request | undefined;
    const api = createFocusApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse(activeFocus));
    });

    const body: SetFocus = {
      source: 'coach',
      coachInstruction: 'Drill pins',
      pairedCatalogueKey: 'tactics-pins',
    };
    await api.setFocus(body);
    expect(await lastRequest?.json()).toEqual(body);
  });

  test('parses validation issues from a rejected focus change', async () => {
    const failedApi = createFocusApi(() =>
      Promise.resolve(
        jsonResponse(
          {
            code: 'validation_failed',
            message: 'Invalid focus.',
            issues: [{ path: 'catalogueKey', message: 'unknown catalogue key' }],
          },
          422,
        ),
      ),
    );

    const setFocus = failedApi.setFocus({ source: 'recommended', catalogueKey: 'nope' });
    await expect(setFocus).rejects.toBeInstanceOf(ApiRequestError);
    await expect(setFocus).rejects.toMatchObject({
      status: 422,
      code: 'validation_failed',
      issues: [{ path: 'catalogueKey', message: 'unknown catalogue key' }],
      message: 'Invalid focus.',
    });
  });

  test('rejects a failed catalogue fetch', async () => {
    const failedApi = createFocusApi(() =>
      Promise.resolve(jsonResponse({ code: 'forbidden', message: 'Sign in.' }, 401)),
    );

    const listFocuses = failedApi.listFocuses();
    await expect(listFocuses).rejects.toBeInstanceOf(ApiRequestError);
    await expect(listFocuses).rejects.toMatchObject({ status: 401, code: 'forbidden' });
  });
});

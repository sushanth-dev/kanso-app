import { describe, expect, test } from 'vitest';
import { ApiRequestError } from './account-api.ts';
import { createNudgeApi } from './nudge-api.ts';

const token = 'nudge-token-123';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function noContentResponse() {
  return new Response(null, { status: 204 });
}

describe('nudge API transport', () => {
  test('unsubscribes via the token path with credentials omitted', async () => {
    let lastRequest: Request | undefined;
    const api = createNudgeApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(noContentResponse());
    });

    await expect(api.unsubscribe(token)).resolves.toBeUndefined();
    const requestUrl = new URL(lastRequest?.url ?? 'about:blank');
    expect(requestUrl.pathname).toBe(`/nudge/unsubscribe/${token}`);
    expect(lastRequest?.method).toBe('GET');
    // The unsubscribe link is opened without a session; the cookie must not go.
    expect(lastRequest?.credentials).toBe('omit');
  });

  test('encodes unsafe token characters in the path', async () => {
    let lastRequest: Request | undefined;
    const api = createNudgeApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(noContentResponse());
    });

    await api.unsubscribe('a b/c');
    expect(new URL(lastRequest?.url ?? 'about:blank').pathname).toBe(
      '/nudge/unsubscribe/a%20b%2Fc',
    );
  });

  test('throws a typed API error when the unsubscribe is rejected', async () => {
    const failedApi = createNudgeApi(() =>
      Promise.resolve(jsonResponse({ code: 'not_found', message: 'Unknown token.' }, 404)),
    );

    const unsubscribe = failedApi.unsubscribe(token);
    await expect(unsubscribe).rejects.toBeInstanceOf(ApiRequestError);
    await expect(unsubscribe).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
      issues: undefined,
      message: 'Unknown token.',
    });
  });

  test('falls back to a default error when the failure body is not an error payload', async () => {
    const failedApi = createNudgeApi(() =>
      Promise.resolve(jsonResponse({ unexpected: true }, 500)),
    );

    const unsubscribe = failedApi.unsubscribe(token);
    await expect(unsubscribe).rejects.toMatchObject({
      status: 500,
      code: 'request_failed',
      message: 'The request failed.',
    });
  });
});

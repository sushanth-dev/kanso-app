import { describe, expect, test } from 'vitest';
import { ApiRequestError } from './account-api.ts';
import { createGuardianApi } from './guardian-api.ts';

const token = 'consent-token-123';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function noContentResponse() {
  return new Response(null, { status: 204 });
}

describe('guardian API transport', () => {
  test('confirms consent via the token path with credentials omitted', async () => {
    let lastRequest: Request | undefined;
    const api = createGuardianApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(noContentResponse());
    });

    await expect(api.confirmGuardian(token)).resolves.toBeUndefined();
    const requestUrl = new URL(lastRequest?.url ?? 'about:blank');
    expect(requestUrl.pathname).toBe(`/guardians/confirm/${token}`);
    expect(lastRequest?.method).toBe('GET');
    // The consent link is opened by a guardian with no session.
    expect(lastRequest?.credentials).toBe('omit');
  });

  test('throws a typed API error when the token is stale', async () => {
    const failedApi = createGuardianApi(() =>
      Promise.resolve(
        jsonResponse(
          {
            code: 'validation_failed',
            message: 'The consent link has expired.',
            issues: [{ path: 'token', message: 'expired' }],
          },
          410,
        ),
      ),
    );

    const confirm = failedApi.confirmGuardian(token);
    await expect(confirm).rejects.toBeInstanceOf(ApiRequestError);
    await expect(confirm).rejects.toMatchObject({
      status: 410,
      code: 'validation_failed',
      issues: [{ path: 'token', message: 'expired' }],
      message: 'The consent link has expired.',
    });
  });

  test('treats any non-204 status as a failure even without an error body', async () => {
    const failedApi = createGuardianApi(() => Promise.resolve(new Response('', { status: 502 })));

    const confirm = failedApi.confirmGuardian(token);
    await expect(confirm).rejects.toMatchObject({
      status: 502,
      code: 'request_failed',
      message: 'The request failed.',
    });
  });
});

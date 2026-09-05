/**
 * The cross-cutting behaviour every handler inherits.
 *
 * These are the tests worth having before the handlers exist, because they
 * cover the things a handler cannot opt into and must not opt out of: a request
 * without a session never reaches route code, an unknown path answers in the
 * contract's error shape rather than the framework's, and a thrown exception
 * never carries its message to a player.
 */
import { describe, expect, test, vi } from 'vitest';
import { createApp, publicPaths, toHonoPath } from './app.ts';
import { routes } from './contract/routes.ts';
import { ApiError } from './contract/schemas.ts';

/** A session object; its shape is better-auth's problem, its presence is ours. */
const signedIn = () => ({ userId: '00000000-0000-4000-8000-000000000000' });

describe('toHonoPath', () => {
  test('rewrites an OpenAPI path parameter into the router syntax', () => {
    expect(toHonoPath('/players/{playerId}/focus')).toBe('/players/:playerId/focus');
  });

  test('rewrites every parameter in a path, not only the first', () => {
    expect(toHonoPath('/players/{playerId}/games/{gameId}')).toBe(
      '/players/:playerId/games/:gameId',
    );
  });

  test('leaves a path with no parameters alone', () => {
    expect(toHonoPath('/me')).toBe('/me');
  });
});

describe('publicPaths', () => {
  test('is derived from the contract rather than restated', () => {
    // Five routes are public, and each is deliberate. The shared proof sheet
    // is read by someone with no account (F14, S6); the shared assignment read
    // is the share act's second caller (ST-117) and answers before anyone
    // signs in; the guardian consent
    // confirm route is reached from an email link (N7); `/health` is called by
    // a load balancer (E3); and the Razorpay webhook is called by Razorpay and
    // verifies the signature instead of a session (ST-044). A new public route
    // declares itself with `security: []` and appears here without this file
    // being touched. If this assertion fails, read the new route before
    // changing the list.
    expect(publicPaths()).toEqual([
      '/health',
      '/guardians/confirm/{token}',
      // ST-126. The nudge unsubscribe link, like the consent confirm, is
      // opened from an email with no session and answers 404 on a bad token.
      '/nudge/unsubscribe/{token}',
      '/shared/proof-sheets/{token}',
      '/shared/assignments/{token}',
      // ST-118. The shared game read is the share act's third caller and
      // answers before anyone signs in.
      '/shared/games/{token}',
      '/payments/webhook',
    ]);
  });
});

describe('the session guard', () => {
  test('refuses every authenticated route without a session', async () => {
    const app = createApp();
    const authenticated = routes.filter((route) => !publicPaths().includes(route.path));
    expect(authenticated.length).toBeGreaterThan(0);

    for (const route of authenticated) {
      // Path parameters are filled with something syntactically plausible; the
      // guard runs before anything looks at them.
      const path = route.path.replace(/\{[^{}]+\}/g, 'x'.repeat(32));
      const response = await app.request(path, { method: route.method.toUpperCase() });

      expect(response.status, `${route.method} ${route.path}`).toBe(401);
      const body: unknown = await response.json();
      expect(ApiError.safeParse(body).success, `${route.method} ${route.path}`).toBe(true);
      expect(body).toMatchObject({ code: 'no_session' });
    }
  });

  test('lets the shared proof sheet through without a session', async () => {
    const app = createApp();
    const response = await app.request(`/shared/proof-sheets/${'x'.repeat(32)}`);

    // No handler is mounted yet, so this falls through to the 404. What matters
    // is that it is not a 401: the route stayed public.
    expect(response.status).not.toBe(401);
  });

  test('lets the guardian consent confirm route through without a session', async () => {
    const app = createApp();

    const response = await app.request(`/guardians/confirm/${'x'.repeat(32)}`);

    // No handler is mounted without a database, so this falls through to the
    // 404. What matters is that it is not a 401: the consent link stays public.
    expect(response.status).not.toBe(401);
  });

  test('lets the shared assignment read through without a session', async () => {
    const app = createApp();
    const response = await app.request(`/shared/assignments/${'x'.repeat(32)}`);

    // No handler is mounted without a database, so this falls through to the
    // 404. What matters is that it is not a 401: the link stays public. The
    // confirm beside it is sessioned and is covered by the loop above.
    expect(response.status).not.toBe(401);
  });

  test('lets the shared game read through without a session', async () => {
    const app = createApp();
    const response = await app.request(`/shared/games/${'x'.repeat(32)}`);

    // No handler is mounted without a database, so this falls through to the
    // 404. What matters is that it is not a 401: the link stays public.
    expect(response.status).not.toBe(401);
  });

  test('fails closed when no session reader is supplied', async () => {
    // The default is "nobody is signed in". An app assembled without wiring
    // better-auth serves no data rather than serving everyone's.
    const response = await createApp().request('/me');
    expect(response.status).toBe(401);
  });

  test('lets a signed-in request past the guard', async () => {
    const app = createApp({ getSession: signedIn });
    const response = await app.request('/me');

    // Past the guard, into the 404 that stands where the handler will be.
    expect(response.status).toBe(404);
  });
});

describe('the not-found response', () => {
  test('answers an unknown path in the contract error shape', async () => {
    const response = await createApp().request('/no-such-thing');

    expect(response.status).toBe(404);
    const body: unknown = await response.json();
    expect(ApiError.safeParse(body).success).toBe(true);
    expect(body).toEqual({ code: 'not_found', message: 'No such endpoint.' });
  });
});

describe('the error handler', () => {
  test('turns a thrown exception into a 500 that leaks nothing', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createApp({ getSession: signedIn });
    app.get('/boom', () => {
      // A deliberately real-looking connection string. The point of the test is
      // that it never reaches a response body, so weakening it to a placeholder
      // would weaken the test. The directive has to sit on the offending line.
      throw new Error('postgres://user:hunter2@db.internal:5432/chess'); // gitleaks:allow
    });

    const response = await app.request('/boom');

    expect(response.status).toBe(500);
    const body: unknown = await response.json();
    expect(ApiError.safeParse(body).success).toBe(true);
    expect(body).toEqual({ code: 'internal_error', message: 'Something went wrong.' });
    expect(JSON.stringify(body)).not.toContain('hunter2');

    // The detail is not lost, it is only kept away from the client.
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

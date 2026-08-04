/**
 * The HTTP application: everything every route needs, and no route itself.
 *
 * The contract (ADR-0013) is defined in `contract/routes.ts` and the handlers
 * that satisfy it are sprint work. What lives here is the part that is wrong to
 * write nineteen times: how an error becomes a response body, what happens to a
 * request for a path nobody serves, and which routes refuse to answer without a
 * session. Those three are cross-cutting, so a handler that forgets one is a
 * hole rather than a gap, and each one is cheap now and expensive to retrofit.
 *
 * Handlers attach with `app.openapi(route, handler)` as stories land. They
 * inherit all of the above by being mounted on this instance.
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context, MiddlewareHandler } from 'hono';
import { routes } from './contract/routes.ts';

/** The shape of every error the API emits, from `ApiError` in the contract. */
export interface ErrorBody {
  code: string;
  message: string;
  issues?: { path: string; message: string }[];
}

/**
 * OpenAPI writes a path parameter as `{playerId}`; Hono matches it as
 * `:playerId`. The contract is the source of both, so the conversion belongs
 * here rather than in a second hand-maintained list of paths.
 */
export function toHonoPath(openApiPath: string): string {
  return openApiPath.replace(/\{([^{}]+)\}/g, ':$1');
}

/**
 * The paths that answer without a session, taken from the contract rather than
 * restated. A route declares itself public with `security: []` (ADR-0013), so
 * adding a public route cannot silently miss this list.
 */
export function publicPaths(): string[] {
  return routes
    .filter((route) => 'security' in route && route.security.length === 0)
    .map((route) => route.path);
}

/**
 * Every route except the shared proof sheet answers 401 without a session.
 *
 * The session itself comes from better-auth (ADR-0011), which is not wired yet.
 * Until it is, `getSession` is the seam: production passes the better-auth
 * reader, tests pass a function that returns whatever the test needs. The guard
 * around it is the part that has to be right on every route, and it is testable
 * now without an auth provider or a database.
 */
export function requireSession(getSession: (c: Context) => unknown): MiddlewareHandler {
  return async (c, next) => {
    if (getSession(c) == null) {
      return c.json<ErrorBody>(
        { code: 'no_session', message: 'Sign in to use this endpoint.' },
        401,
      );
    }
    await next();
  };
}

export interface AppOptions {
  /**
   * Reads the session off the request. Returns null or undefined when there is
   * none. Defaults to "nobody is signed in", which is the correct behaviour for
   * an app with no auth provider mounted: fail closed, never open.
   */
  getSession?: (c: Context) => unknown;
}

export function createApp({ getSession = () => null }: AppOptions = {}) {
  const app = new OpenAPIHono({
    /**
     * A validation failure is a 400 in the contract, so it is answered in the
     * contract's own error shape rather than in the framework's default. The
     * field paths go out because a client cannot fix a request it cannot see
     * the fault in; nothing else about the request does.
     */
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json<ErrorBody>(
          {
            code: 'invalid_request',
            message: 'The request failed validation.',
            issues: result.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
          400,
        );
      }
      return undefined;
    },
  });

  const open = new Set(publicPaths());
  for (const route of routes) {
    if (open.has(route.path)) continue;
    app.use(toHonoPath(route.path), requireSession(getSession));
  }

  app.notFound((c) => c.json<ErrorBody>({ code: 'not_found', message: 'No such endpoint.' }, 404));

  /**
   * The last line before a stack trace reaches a player. The message is fixed
   * rather than taken from the error, because an exception message is written
   * for us and routinely carries a query, a path, or a connection string.
   */
  app.onError((error, c) => {
    console.error('Unhandled error', error);
    return c.json<ErrorBody>({ code: 'internal_error', message: 'Something went wrong.' }, 500);
  });

  return app;
}

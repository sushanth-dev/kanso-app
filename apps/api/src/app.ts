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
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { routes } from './contract/routes.ts';
import { mountMe } from './account/me.ts';
import { mountCreatePlayer } from './account/create-player.ts';
import { mountUpdatePlayer } from './account/update-player.ts';
import { mountAttachGuardian } from './account/attach-guardian.ts';
import { mountConfirmGuardian } from './account/confirm-guardian.ts';
import { mountHealth } from './health.ts';
import { mountImport } from './import/import-games.ts';
import { httpGameFetcher, type GameFetcher } from './import/game-fetcher.ts';
import { mountListGames } from './games/list-games.ts';
import { mountSetGameColor } from './games/set-game-color.ts';
import { mountListTournaments } from './tournaments/list-tournaments.ts';
import { mountGetTournament } from './tournaments/get-tournament.ts';
import { mountRoundDecay } from './tournaments/round-decay.ts';
import { realSessionReader } from './session.ts';
import type * as schema from './db/schema.ts';
import { sesConfigFromEnv, sesMailer, type Mailer } from './account/mailer.ts';
import { httpRatingFetcher, type RatingFetcher } from './rating/rating-fetcher.ts';
import { mountTransferGap } from './rating/transfer-gap.ts';
import { mountMotifs } from './motifs/motifs.ts';
import { mountPhases } from './phases/phases.ts';

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
    if ((await getSession(c)) == null) {
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
   * an app with no auth provider mounted: fail closed, never open. When `auth`
   * is supplied and `getSession` is not, this defaults to the real
   * better-auth reader.
   */
  getSession?: (c: Context) => unknown;
  /**
   * The better-auth instance (ADR-0011). When supplied, its routes are mounted
   * under `/api/auth/*` outside the OpenAPI contract, and `getSession` defaults
   * to reading a real session from it. Optional because the cross-cutting tests
   * assemble an app with a stubbed session and no auth provider.
   */
  auth?: {
    handler: (request: Request) => Promise<Response>;
    api: {
      getSession: (args: { headers: Headers }) => Promise<{ session: { userId: string } } | null>;
    };
  };
  /**
   * The database handlers read and write. Optional because the cross-cutting
   * tests assemble an app that never reaches a handler; a handler that needs it
   * is only mounted when it is supplied.
   */
  db?: PostgresJsDatabase<typeof schema>;
  /**
   * Sends the guardian consent notice. Defaults to SES reading its
   * configuration from the environment; tests pass a fake so no test sends
   * real mail.
   */
  mailer?: Mailer;
  /**
   * Fetches online ratings from Chess.com and Lichess. Defaults to the real
   * HTTP fetchers; tests pass a fake so no test makes a real outbound call.
   */
  ratingFetcher?: RatingFetcher;
  /**
   * Fetches games from Chess.com and Lichess by username. Defaults to the real
   * HTTP fetchers; tests pass a fake so no test makes a real outbound call.
   */
  gameFetcher?: GameFetcher;
}

export function createApp({
  getSession,
  auth,
  db,
  mailer: mailerOption,
  ratingFetcher: ratingFetcherOption,
  gameFetcher: gameFetcherOption,
}: AppOptions = {}) {
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

  // The session reader: the caller's stub wins, otherwise the real reader when
  // an auth instance is mounted, otherwise nobody is signed in.
  const effectiveGetSession = getSession ?? (auth ? realSessionReader(auth) : () => null);

  // better-auth owns its routes and their shape (ADR-0011). They are mounted
  // outside the OpenAPI contract, as `contract/routes.ts` already states they
  // will be, so `publicPaths()` is unaffected.
  if (auth) {
    app.all('/api/auth/*', (c) => auth.handler(c.req.raw));
  }

  const open = new Set(publicPaths());
  const guarded = new Set<string>();
  for (const route of routes) {
    if (open.has(route.path) || guarded.has(route.path)) continue;
    guarded.add(route.path);
    app.use(toHonoPath(route.path), requireSession(effectiveGetSession));
  }

  if (db) {
    const mailer = mailerOption ?? sesMailer(sesConfigFromEnv());
    const ratingFetcher = ratingFetcherOption ?? httpRatingFetcher;
    const gameFetcher = gameFetcherOption ?? httpGameFetcher;
    mountHealth(app, { db });
    mountMe(app, { db, getSession: effectiveGetSession });
    mountCreatePlayer(app, { db, getSession: effectiveGetSession });
    mountUpdatePlayer(app, { db, getSession: effectiveGetSession });
    mountAttachGuardian(app, { db, getSession: effectiveGetSession, mailer });
    mountConfirmGuardian(app, { db });
    mountImport(app, { db, getSession: effectiveGetSession, gameFetcher });
    mountListGames(app, { db, getSession: effectiveGetSession });
    mountSetGameColor(app, { db, getSession: effectiveGetSession });
    mountListTournaments(app, { db, getSession: effectiveGetSession });
    mountGetTournament(app, { db, getSession: effectiveGetSession });
    mountRoundDecay(app, { db, getSession: effectiveGetSession });
    mountTransferGap(app, { db, getSession: effectiveGetSession, ratingFetcher });
    mountMotifs(app, { db, getSession: effectiveGetSession });
    mountPhases(app, { db, getSession: effectiveGetSession });
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

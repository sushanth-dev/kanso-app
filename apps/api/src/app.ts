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
import { cors } from 'hono/cors';
import { requestId } from 'hono/request-id';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { routes } from './contract/routes.ts';
import { mountMe } from './account/me.ts';
import { mountUpdatePlayer } from './account/update-player.ts';
import { mountConfirmGuardian } from './account/confirm-guardian.ts';
import { isConsentGated } from './account/consent-request.ts';
import { mountHealth } from './health.ts';
import { mountImport } from './import/import-games.ts';
import { httpGameFetcher, type GameFetcher } from './import/game-fetcher.ts';
import { mountListGames } from './games/list-games.ts';
import { mountGetGame } from './games/get-game.ts';
import { mountSetGameColor } from './games/set-game-color.ts';
import { mountListTournaments } from './tournaments/list-tournaments.ts';
import { mountGetTournament } from './tournaments/get-tournament.ts';
import { mountRoundDecay } from './tournaments/round-decay.ts';
import { realSessionReader, readSession } from './session.ts';
import type * as schema from './db/schema.ts';
import { httpRatingFetcher, type RatingFetcher } from './rating/rating-fetcher.ts';
import { mountTransferGap } from './rating/transfer-gap.ts';
import { mountMotifs } from './motifs/motifs.ts';
import { mountPhases } from './phases/phases.ts';
import { mountReport } from './report/report.ts';
import { mountListFocuses } from './focus/list-focuses.ts';
import { mountGetFocus } from './focus/get-focus.ts';
import { mountSetFocus } from './focus/set-focus.ts';
import { mountProofSheets } from './proof-sheet/proof-sheet.ts';
import { mountCheckout } from './billing/checkout.ts';
import { tierFor } from './billing/entitlement.ts';
import {
  httpRazorpayClient,
  razorpayConfigFromEnv,
  type RazorpayClient,
} from './billing/razorpay.ts';
import { mountRazorpayWebhook } from './billing/webhook.ts';
import { mountExplanation, mountSocraticQuestion } from './coaching/explanation.ts';
import { httpGeminiClient, geminiConfigFromEnv, type AiClient } from './coaching/gemini.ts';
import { log } from './logging.ts';

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
 * The routes a free account cannot reach: the Focus and Proof sheet surfaces,
 * minus the public shared proof sheet. Taken from the contract tags rather than
 * a second hand-maintained list, so a new paid route is gated by default.
 */
export function paidPaths(): string[] {
  const public_ = new Set(publicPaths());
  return routes
    .filter((route) => {
      const tags = route.tags as readonly string[];
      return tags.includes('Focus') || tags.includes('Proof sheet');
    })
    .map((route) => route.path)
    .filter((path) => !public_.has(path));
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

/**
 * The consent gate (ST-034): a signed-in minor whose guardian has not yet
 * confirmed is refused every product route. It runs after `requireSession`, so
 * it can assume a session and does one database read in the shared path rather
 * than one per handler. Applied only when `db` is supplied, like the handlers
 * themselves.
 */
export function requireConsent(
  db: PostgresJsDatabase<typeof schema>,
  getSession: (c: Context) => unknown,
): MiddlewareHandler {
  return async (c, next) => {
    const session = await readSession(getSession, c);
    if (session === null || !(await isConsentGated(db, session.userId))) {
      await next();
      return;
    }
    return c.json<ErrorBody>(
      {
        code: 'consent_required',
        message: 'A guardian must confirm consent before you can use KansoChess.',
      },
      403,
    );
  };
}

/**
 * The tier gate (ST-044, ST-074): a beginner account is refused every paid
 * route; intermediate and pro both pass. It runs after `requireSession` and
 * `requireConsent`, so it can assume a session and does one database read in
 * the shared path. The response is the upgrade signal, not a hidden UI
 * element, so a direct request refuses too.
 */
export function requirePaid(
  db: PostgresJsDatabase<typeof schema>,
  getSession: (c: Context) => unknown,
): MiddlewareHandler {
  return async (c, next) => {
    const session = await readSession(getSession, c);
    if (session === null || (await tierFor(db, session.userId)) !== 'beginner') {
      await next();
      return;
    }
    return c.json<ErrorBody>({ code: 'upgrade_required', message: 'Upgrade to unlock this.' }, 403);
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
   * Fetches online ratings from Chess.com and Lichess. Defaults to the real
   * HTTP fetchers; tests pass a fake so no test makes a real outbound call.
   */
  ratingFetcher?: RatingFetcher;
  /**
   * Fetches games from Chess.com and Lichess by username. Defaults to the real
   * HTTP fetchers; tests pass a fake so no test makes a real outbound call.
   */
  gameFetcher?: GameFetcher;
  /**
   * Creates Razorpay orders and verifies webhooks. Defaults to the real client
   * read from the environment; tests pass a fake so no test calls Razorpay.
   */
  razorpay?: RazorpayClient;
  /**
   * Generates mistake explanations and Socratic questions (ADR-0018). Defaults
   * to the real Gemini client read from the environment; tests pass a fake so
   * no test calls Gemini.
   */
  aiClient?: AiClient;
}

export function createApp({
  getSession,
  auth,
  db,
  ratingFetcher: ratingFetcherOption,
  gameFetcher: gameFetcherOption,
  razorpay: razorpayOption,
  aiClient: aiClientOption,
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
  // One request id per request, generated or accepted, echoed on the response
  // and readable by every handler as `c.get('requestId')`. It is what ties an
  // import request to its analysis jobs (ST-045).
  app.use('*', requestId());
  // The browser's cross-origin session (ST-030 Part 2). The allowlist is read
  // from CORS_ORIGINS rather than a literal, so an unknown origin gets no
  // allow-origin header and the request fails closed rather than being
  // answered with `*`. Unset - local dev through the Vite proxy - is a no-op,
  // because the proxy never crosses an origin.
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (corsOrigins.length > 0) {
    app.use('*', cors({ origin: corsOrigins, credentials: true }));
  }

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
  const paid = new Set(paidPaths());
  const guarded = new Set<string>();
  for (const route of routes) {
    if (open.has(route.path) || guarded.has(route.path)) continue;
    guarded.add(route.path);
    app.use(toHonoPath(route.path), requireSession(effectiveGetSession));
    if (db) {
      app.use(toHonoPath(route.path), requireConsent(db, effectiveGetSession));
      if (paid.has(route.path)) {
        app.use(toHonoPath(route.path), requirePaid(db, effectiveGetSession));
      }
    }
  }

  if (db) {
    const ratingFetcher = ratingFetcherOption ?? httpRatingFetcher;
    const gameFetcher = gameFetcherOption ?? httpGameFetcher;
    const razorpayConfig = razorpayConfigFromEnv();
    const razorpay = razorpayOption ?? (razorpayConfig ? httpRazorpayClient(razorpayConfig) : null);
    const geminiConfig = geminiConfigFromEnv();
    const aiClient = aiClientOption ?? (geminiConfig ? httpGeminiClient(geminiConfig) : null);
    mountHealth(app, { db });
    mountMe(app, { db, getSession: effectiveGetSession });
    mountUpdatePlayer(app, { db, getSession: effectiveGetSession });
    mountConfirmGuardian(app, { db });
    mountImport(app, { db, getSession: effectiveGetSession, gameFetcher });
    mountListGames(app, { db, getSession: effectiveGetSession });
    mountGetGame(app, { db, getSession: effectiveGetSession });
    mountSetGameColor(app, { db, getSession: effectiveGetSession });
    mountListTournaments(app, { db, getSession: effectiveGetSession });
    mountGetTournament(app, { db, getSession: effectiveGetSession });
    mountRoundDecay(app, { db, getSession: effectiveGetSession });
    mountTransferGap(app, { db, getSession: effectiveGetSession, ratingFetcher });
    mountMotifs(app, { db, getSession: effectiveGetSession });
    mountPhases(app, { db, getSession: effectiveGetSession });
    mountReport(app, { db, getSession: effectiveGetSession });
    mountListFocuses(app, { db });
    mountGetFocus(app, { db, getSession: effectiveGetSession });
    mountSetFocus(app, { db, getSession: effectiveGetSession });
    mountProofSheets(app, { db, getSession: effectiveGetSession });
    if (razorpay) {
      mountCheckout(app, { db, getSession: effectiveGetSession, razorpay });
      mountRazorpayWebhook(app, { db, razorpay });
    }
    if (aiClient) {
      mountExplanation(app, { db, getSession: effectiveGetSession, aiClient });
      mountSocraticQuestion(app, { db, getSession: effectiveGetSession, aiClient });
    }
  }

  app.notFound((c) => c.json<ErrorBody>({ code: 'not_found', message: 'No such endpoint.' }, 404));

  /**
   * The last line before a stack trace reaches a player. The message is fixed
   * rather than taken from the error, because an exception message is written
   * for us and routinely carries a query, a path, or a connection string.
   */
  app.onError((error, c) => {
    log('error', 'unhandled_error', {
      requestId: c.get('requestId'),
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json<ErrorBody>({ code: 'internal_error', message: 'Something went wrong.' }, 500);
  });

  return app;
}

/**
 * ST-153. The pre-game priming surface: the token the extension holds and the
 * brief it reads with it.
 *
 * The token is a credential, not a share link: it keeps serving whatever the
 * brief currently holds for as long as it is live. So it is stored hashed,
 * shown in full once at creation, revocable from settings, and one live token
 * per player - creating a new one revokes the old, the rotation rule. The
 * brief itself is labels and counts only; the payload-scoping test pins the
 * key set so the brief cannot quietly grow into a profile.
 */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import {
  createPrimingToken,
  getPrimingBrief,
  listPrimingTokens,
  revokePrimingToken,
} from '../contract/routes.ts';
import { PrimingBrief } from '../contract/schemas.ts';
import type { z } from 'zod';
import * as schema from '../db/schema.ts';
import {
  focusCatalogue,
  game,
  mistake,
  movePly,
  playerFocus,
  primingToken,
  rateLimitBucket,
} from '../db/schema.ts';
import { TROUBLE_CLOCK_MS } from '../phases/phases.ts';
import { readSession } from '../session.ts';
import { getOwnPlayerId, hasPlayerClaim } from '../players/claim.ts';
import { generateToken } from '../proof-sheet/compose.ts';
import { groupKeyOf } from '../report/evidence.ts';

type Db = PostgresJsDatabase<typeof schema>;
type Stream = (typeof schema.streamEnum.enumValues)[number];
type WeaknessKind = (typeof schema.weaknessKindEnum.enumValues)[number];

const BEARER_PREFIX = 'Bearer ';
/** How long the brief endpoint's fixed window runs, and how many reads it allows. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
/** The brief reaches back seven days for the instance counts. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_GROUPS = 3;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * The fixed-window limiter for the brief endpoint, keyed on the player id.
 * Counted in the database because the API runs more than one instance; an
 * in-memory map would multiply the limit by the instance count. One upsert
 * per request.
 */
async function consumeRateLimit(db: Db, key: string): Promise<boolean> {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS);
  // The case expression binds the window as an ISO string: a Date object in a
  // raw sql fragment serializes with toString(), which Postgres cannot parse.
  const windowIso = windowStart.toISOString();
  const [row] = await db
    .insert(rateLimitBucket)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: rateLimitBucket.key,
      set: {
        count: sql`case when ${rateLimitBucket.windowStart} = ${windowIso}::timestamptz then ${rateLimitBucket.count} + 1 else 1 end`,
        windowStart,
      },
    })
    .returning();
  return row !== undefined && row.count <= RATE_LIMIT_MAX;
}

/** The live token for a player, or null. At most one exists by the rotation rule. */
async function liveToken(db: Db, playerId: string) {
  const [row] = await db
    .select()
    .from(primingToken)
    .where(and(eq(primingToken.createdByPlayerId, playerId), isNull(primingToken.revokedAt)))
    .orderBy(desc(primingToken.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * The bearer token's player, or null. Missing, malformed, unknown, and
 * revoked all return null and the caller answers the same 401, so the
 * endpoint never confirms which one happened.
 */
async function playerForBearer(db: Db, authorization: string | undefined) {
  if (authorization === undefined || !authorization.startsWith(BEARER_PREFIX)) return null;
  const secret = authorization.slice(BEARER_PREFIX.length).trim();
  if (secret.length === 0) return null;
  const [row] = await db
    .select({ createdByPlayerId: primingToken.createdByPlayerId })
    .from(primingToken)
    .where(and(eq(primingToken.tokenHash, hashToken(secret)), isNull(primingToken.revokedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * One weakness group's mistake instances over the trailing seven days,
 * counted fresh rather than read from the stored report, so a quiet week
 * reads as a quiet week. The key is the one `groupKeyOf` recovers, the same
 * key the evidence query groups by.
 */
async function weekCountFor(
  db: Db,
  playerId: string,
  stream: Stream,
  kind: WeaknessKind,
  key: string | null,
): Promise<number> {
  const scope = and(
    eq(game.playerId, playerId),
    eq(game.stream, stream),
    eq(game.analysisStatus, 'complete'),
    gte(game.playedAt, new Date(Date.now() - WEEK_MS)),
  );

  if (kind === 'opening') {
    const [row] = await db
      .select({ count: sql<number>`count(${mistake.id})::int` })
      .from(mistake)
      .innerJoin(game, eq(mistake.gameId, game.id))
      .where(and(scope, key === null ? sql`false` : eq(game.eco, key)));
    return row?.count ?? 0;
  }
  if (kind === 'time_trouble') {
    const [row] = await db
      .select({ count: sql<number>`count(${mistake.id})::int` })
      .from(mistake)
      .innerJoin(game, eq(mistake.gameId, game.id))
      .innerJoin(movePly, and(eq(movePly.gameId, mistake.gameId), eq(movePly.ply, mistake.ply)))
      .where(and(scope, lte(movePly.clockMs, TROUBLE_CLOCK_MS)));
    return row?.count ?? 0;
  }
  const [row] = await db
    .select({ count: sql<number>`count(${mistake.id})::int` })
    .from(mistake)
    .innerJoin(game, eq(mistake.gameId, game.id))
    .where(
      and(
        scope,
        kind === 'motif'
          ? eq(mistake.motif, key ?? '')
          : eq(mistake.phase, (key ?? '') as (typeof schema.phaseEnum.enumValues)[number]),
      ),
    );
  return row?.count ?? 0;
}

/**
 * The brief: the top weakness groups across the player's latest stream
 * reports, worst first by the severity the reports ranked with, then the
 * active focus line. Reports are stored, not recomputed, so the brief never
 * triggers the leak pipeline; a stream with no report simply contributes
 * nothing.
 */
export async function composeBrief(
  db: Db,
  playerId: string,
): Promise<z.infer<typeof PrimingBrief>> {
  const reports = await db
    .select({ id: schema.report.id, stream: schema.report.stream })
    .from(schema.report)
    .where(eq(schema.report.playerId, playerId))
    .orderBy(desc(schema.report.generatedAt));

  // Latest report per stream: the first row seen wins, the rest are history.
  const seen = new Set<Stream>();
  const latest = reports.filter((r) => !seen.has(r.stream) && seen.add(r.stream));

  const candidates: {
    label: string;
    stream: Stream;
    kind: WeaknessKind;
    eco: string | null;
    rank: number;
    ratingLeak: number;
  }[] = [];
  for (const r of latest) {
    const weaknesses = await db
      .select()
      .from(schema.weakness)
      .where(eq(schema.weakness.reportId, r.id))
      .orderBy(asc(schema.weakness.rank));
    for (const w of weaknesses) {
      candidates.push({
        label: w.label,
        stream: r.stream,
        kind: w.kind,
        eco: w.eco,
        rank: w.rank,
        ratingLeak: w.ratingLeak,
      });
    }
  }
  // Worst first across streams: rank inside a report, then the leak number as
  // the between-reports tiebreak, since two reports share no rank scale.
  candidates.sort((a, b) => a.rank - b.rank || b.ratingLeak - a.ratingLeak);

  const groups: z.infer<typeof PrimingBrief>['groups'] = [];
  for (const c of candidates) {
    if (groups.length >= MAX_GROUPS) break;
    const key = groupKeyOf(c.kind, c.label, c.eco);
    if (key === null && c.kind !== 'time_trouble') continue;
    const weekCount = await weekCountFor(db, playerId, c.stream, c.kind, key);
    groups.push({ label: c.label, stream: c.stream, weekCount });
  }

  const [focus] = await db
    .select({ title: focusCatalogue.title, instruction: playerFocus.coachInstruction })
    .from(playerFocus)
    .leftJoin(focusCatalogue, eq(playerFocus.catalogueId, focusCatalogue.id))
    .where(and(eq(playerFocus.playerId, playerId), isNull(playerFocus.endedAt)))
    .limit(1);
  const focusLabel = focus ? (focus.title ?? focus.instruction) : null;

  return { groups, focusLabel };
}

export function mountPriming(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(createPrimingToken, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }
    const playerId = await getOwnPlayerId(deps.db, session.userId);
    if (playerId === null) {
      return c.json({ code: 'not_found', message: 'No such player.' }, 404);
    }

    // Rotation: one live token per player, so creating retires the previous.
    await deps.db
      .update(primingToken)
      .set({ revokedAt: new Date() })
      .where(and(eq(primingToken.createdByPlayerId, playerId), isNull(primingToken.revokedAt)));

    const secret = generateToken();
    const [created] = await deps.db
      .insert(primingToken)
      .values({ createdByPlayerId: playerId, tokenHash: hashToken(secret) })
      .returning();

    return c.json(
      {
        id: created!.id,
        tokenPrefix: secret.slice(0, 8),
        token: secret,
        createdAt: created!.createdAt.toISOString(),
      },
      201,
    );
  });

  app.openapi(listPrimingTokens, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }
    const playerId = await getOwnPlayerId(deps.db, session.userId);
    if (playerId === null) {
      return c.json({ code: 'not_found', message: 'No such player.' }, 404);
    }

    const live = await liveToken(deps.db, playerId);
    if (live === null) return c.json([], 200);
    // The prefix comes from the hash, not the secret: the stored column is the
    // only thing the list ever has.
    return c.json(
      [
        {
          id: live.id,
          tokenPrefix: live.tokenHash.slice(0, 8),
          createdAt: live.createdAt.toISOString(),
        },
      ],
      200,
    );
  });

  app.openapi(revokePrimingToken, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'No session.' }, 401);
    }

    const { tokenId } = c.req.valid('param');
    const [row] = await deps.db
      .select({ createdByPlayerId: primingToken.createdByPlayerId })
      .from(primingToken)
      .where(eq(primingToken.id, tokenId))
      .limit(1);
    if (!row) {
      return c.json({ code: 'not_found', message: 'No such priming token.' }, 404);
    }
    if (!(await hasPlayerClaim(deps.db, session.userId, row.createdByPlayerId))) {
      return c.json({ code: 'forbidden', message: 'Not your priming token.' }, 403);
    }

    await deps.db
      .update(primingToken)
      .set({ revokedAt: new Date() })
      .where(eq(primingToken.id, tokenId));
    return c.body(null, 204);
  });

  app.openapi(getPrimingBrief, async (c) => {
    const player = await playerForBearer(deps.db, c.req.header('Authorization'));
    if (player === null) {
      return c.json({ code: 'unauthorized', message: 'Unknown, revoked, or missing token.' }, 401);
    }
    if (!(await consumeRateLimit(deps.db, `priming-brief:${player.createdByPlayerId}`))) {
      return c.json({ code: 'rate_limited', message: 'Too many requests.' }, 429);
    }

    const brief = await composeBrief(deps.db, player.createdByPlayerId);
    c.header('Cache-Control', 'no-store');
    return c.json(brief, 200);
  });
}

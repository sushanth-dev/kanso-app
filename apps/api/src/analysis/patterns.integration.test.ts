/**
 * ST-150. The `GET /patterns` read side against a real PostgreSQL. The four
 * stored states read straight through, the fifth (`not_yet_verifiable`) is
 * derived for a candidate whose window is thinner than the floor, a came-back
 * group names the game that triggered the relapse, and the read is predicated
 * on the session's player and the requested stream.
 */
import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { user } from '../db/auth-schema.ts';
import { game, mistake, movePly, patternState, player } from '../db/schema.ts';
import { TROUBLE_CLOCK_MS } from '../phases/phases.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import { createApp } from '../app.ts';

let harness: IntegrationDatabase;
let pid = '';

const PAST = (days: number) => new Date(Date.now() - days * 86_400_000);

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
  await harness.db
    .insert(user)
    .values([{ id: 'user_owner', name: 'Owner', email: 'owner@example.com', emailVerified: true }]);
  const [p] = await harness.db
    .insert(player)
    .values({ ownerUserId: 'user_owner', displayName: 'Mina' })
    .returning({ id: player.id });
  pid = p!.id;
});

function app(userId: string | null) {
  return createApp({
    db: harness.db,
    getSession: (userId === null ? () => null : () => ({ userId })) as (c: Context) => unknown,
  });
}

async function get(userId: string | null, stream: string) {
  return app(userId).request(`/patterns?stream=${stream}`);
}

interface PatternBody {
  kind: string;
  groupKey: string;
  label: string;
  stream: string;
  state: string;
  masteredAt: string;
  retiredAt: string | null;
  cameBackAt: string | null;
  lastAlertGame: {
    gameId: string;
    playedAt: string | null;
    whiteName: string | null;
    blackName: string | null;
  } | null;
  windowGames: number;
  windowInstances: number;
  windowCost: number;
  relapses: number;
}

async function seedGame(opts: {
  stream?: 'tournament' | 'online';
  playedAt?: Date;
  timeControl?: string | null;
  eco?: string;
  whiteName?: string;
  blackName?: string;
}): Promise<string> {
  const { stream = 'tournament', playedAt = PAST(1), timeControl = null } = opts;
  const [g] = await harness.db
    .insert(game)
    .values({
      playerId: pid,
      stream,
      source: 'pgn_upload',
      pgnHash: `hash-${crypto.randomUUID()}`,
      pgn: '1. e4 e5 2. Nf3 1-0',
      result: '1-0',
      playerColor: 'white',
      whiteName: opts.whiteName ?? 'Mina',
      blackName: opts.blackName ?? 'Rival',
      playedAt,
      timeControl,
      eco: opts.eco ?? null,
      analysisStatus: 'complete',
    })
    .returning({ id: game.id });
  return g!.id;
}

async function seedPattern(opts: {
  kind: 'opening' | 'motif' | 'phase' | 'time_trouble';
  groupKey: string;
  stream?: 'tournament' | 'online';
  state?: 'active' | 'candidate' | 'retired' | 'came_back';
  masteredDaysAgo?: number;
  relapses?: number;
  lastAlertGameId?: string | null;
}): Promise<string> {
  const {
    kind,
    groupKey,
    stream = 'tournament',
    state = 'candidate',
    masteredDaysAgo = 30,
    lastAlertGameId = null,
  } = opts;
  const [row] = await harness.db
    .insert(patternState)
    .values({
      playerId: pid,
      kind,
      groupKey,
      stream,
      label: groupKey,
      state,
      masteredAt: PAST(masteredDaysAgo),
      retiredAt: state === 'retired' || state === 'came_back' ? PAST(20) : null,
      cameBackAt: state === 'came_back' ? PAST(3) : null,
      lastAlertGameId,
      relapses: opts.relapses ?? 0,
    })
    .returning({ id: patternState.id });
  return row!.id;
}

/** Window games for a candidate row: analysed, in the stream, after masteredAt. */
async function windowGames(count: number, stream: 'tournament' | 'online'): Promise<void> {
  for (let i = 0; i < count; i++) {
    await seedGame({ stream, playedAt: PAST(i + 2) });
  }
}

describe('GET /patterns', () => {
  test('reads all four stored states straight through', async () => {
    const alertGame = await seedGame({ playedAt: PAST(3) });
    await seedPattern({ kind: 'motif', groupKey: 'hanging_piece', state: 'active' });
    await seedPattern({ kind: 'phase', groupKey: 'endgame', state: 'candidate' });
    await seedPattern({ kind: 'opening', groupKey: 'B01', state: 'retired' });
    await seedPattern({
      kind: 'time_trouble',
      groupKey: 'time_trouble',
      state: 'came_back',
      lastAlertGameId: alertGame,
    });

    const res = await get('user_owner', 'tournament');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      playerId: string;
      stream: string;
      patterns: PatternBody[];
    };
    expect(body.playerId).toBe(pid);
    expect(body.stream).toBe('tournament');

    const byKey = new Map(body.patterns.map((p) => [p.groupKey, p]));
    expect(byKey.get('hanging_piece')!.state).toBe('active');
    // No window games are seeded here, so a candidate cannot be verified yet:
    // the read derives the fifth state rather than answering the stored word.
    expect(byKey.get('endgame')!.state).toBe('not_yet_verifiable');
    expect(byKey.get('B01')!.state).toBe('retired');
    expect(byKey.get('B01')!.retiredAt).not.toBeNull();

    const cameBack = byKey.get('time_trouble')!;
    expect(cameBack.state).toBe('came_back');
    expect(cameBack.cameBackAt).not.toBeNull();
    expect(cameBack.lastAlertGame).toEqual({
      gameId: alertGame,
      playedAt: expect.any(String) as string,
      whiteName: 'Mina',
      blackName: 'Rival',
    });
  });

  test('a candidate with a thick window answers candidate; a thin one answers not_yet_verifiable', async () => {
    await seedPattern({ kind: 'motif', groupKey: 'thick', masteredDaysAgo: 30 });
    await seedPattern({ kind: 'motif', groupKey: 'thin', masteredDaysAgo: 1 });
    await windowGames(10, 'tournament');

    const body = (await (await get('user_owner', 'tournament')).json()) as {
      patterns: PatternBody[];
    };
    const byKey = new Map(body.patterns.map((p) => [p.groupKey, p]));
    expect(byKey.get('thick')!.state).toBe('candidate');
    expect(byKey.get('thin')!.state).toBe('not_yet_verifiable');
  });

  test('answers only the requested stream', async () => {
    await seedPattern({ kind: 'motif', groupKey: 't_row', stream: 'tournament' });
    await seedPattern({ kind: 'motif', groupKey: 'o_row', stream: 'online' });

    const body = (await (await get('user_owner', 'online')).json()) as {
      patterns: PatternBody[];
    };
    expect(body.patterns.map((p) => p.groupKey)).toEqual(['o_row']);
    expect(body.patterns[0]!.stream).toBe('online');
  });

  test('never answers another player’s rows', async () => {
    await seedPattern({ kind: 'motif', groupKey: 'hanging_piece' });
    const [other] = await harness.db
      .insert(user)
      .values([
        { id: 'user_other', name: 'Other', email: 'other@example.com', emailVerified: true },
      ])
      .returning({ id: user.id });
    const [otherPlayer] = await harness.db
      .insert(player)
      .values({ ownerUserId: other!.id, displayName: 'Rival' })
      .returning({ id: player.id });
    await seedGame({ playedAt: PAST(1) });

    const res = await app('user_other').request('/patterns?stream=tournament');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { playerId: string; patterns: PatternBody[] };
    expect(body.playerId).toBe(otherPlayer!.id);
    expect(body.patterns).toEqual([]);
  });

  test('refuses without a session and without a claimed player', async () => {
    expect((await get(null, 'tournament')).status).toBe(401);

    // A signed-in user with no player row.
    await harness.db
      .insert(user)
      .values([{ id: 'user_bare', name: 'Bare', email: 'bare@example.com', emailVerified: true }]);
    expect((await get('user_bare', 'tournament')).status).toBe(404);
  });
});

/**
 * ST-152. One mistake row on a game, carrying the motif, the clock, and the
 * half-points the window balance reads. `clockMs` seeds the matching
 * `move_ply` row the time-trouble scope joins.
 */
async function seedMistake(
  gameId: string,
  opts: { motif?: string; halfPointsLost?: number; clockMs?: number | null; ply?: number } = {},
): Promise<void> {
  const { motif = null, halfPointsLost = 1.5, clockMs = null, ply = 5 } = opts;
  if (clockMs !== null) {
    await harness.db.insert(movePly).values({
      gameId,
      ply,
      san: 'Qf6',
      uci: 'd8f6',
      fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      clockMs,
      evalCp: -300,
    });
  }
  await harness.db.insert(mistake).values({
    gameId,
    ply,
    moveNumber: 3,
    movingColor: 'black',
    phase: null,
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moveSan: 'Qf6',
    bestMoveSan: 'Nc6',
    judgement: 'blunder',
    cpLoss: 300,
    winProbDrop: 0.2,
    motif,
    halfPointsLost,
  });
}

describe('ST-152: the window balance on the read side', () => {
  test('a row carries its window games, instances, and cost', async () => {
    await seedPattern({ kind: 'motif', groupKey: 'hanging_piece' });
    const a = await seedGame({ stream: 'tournament' });
    const b = await seedGame({ stream: 'tournament' });
    await seedMistake(a, { motif: 'hanging_piece', halfPointsLost: 1.5 });
    await seedMistake(a, { motif: 'hanging_piece', halfPointsLost: 0.5, ply: 7 });
    await seedMistake(b, { motif: 'fork', halfPointsLost: 2.0 });

    const body = (await (await get('user_owner', 'tournament')).json()) as {
      patterns: PatternBody[];
    };
    const row = body.patterns[0]!;
    expect(row.windowGames).toBe(2);
    expect(row.windowInstances).toBe(2);
    expect(row.windowCost).toBe(2.0);
    expect(row.relapses).toBe(0);
  });

  test('games outside the window carry no instances and no cost', async () => {
    await seedPattern({ kind: 'motif', groupKey: 'hanging_piece', masteredDaysAgo: 30 });
    const old = await seedGame({ stream: 'tournament', playedAt: PAST(40) });
    await seedMistake(old, { motif: 'hanging_piece', halfPointsLost: 3.0 });
    const fresh = await seedGame({ stream: 'tournament' });
    await seedMistake(fresh, { motif: 'hanging_piece', halfPointsLost: 1.0 });

    const body = (await (await get('user_owner', 'tournament')).json()) as {
      patterns: PatternBody[];
    };
    const row = body.patterns[0]!;
    expect(row.windowGames).toBe(1);
    expect(row.windowInstances).toBe(1);
    expect(row.windowCost).toBe(1.0);
  });

  test('an online rapid game contributes nothing to the balance', async () => {
    await seedPattern({ kind: 'motif', groupKey: 'hanging_piece', stream: 'online' });
    const rapid = await seedGame({ stream: 'online', timeControl: '900+10' });
    await seedMistake(rapid, { motif: 'hanging_piece', halfPointsLost: 4.0 });

    const body = (await (await get('user_owner', 'online')).json()) as {
      patterns: PatternBody[];
    };
    const row = body.patterns[0]!;
    expect(row.windowGames).toBe(0);
    expect(row.windowInstances).toBe(0);
    expect(row.windowCost).toBe(0);
  });

  test("opening instances are the mistakes in the eco's window games", async () => {
    await seedPattern({ kind: 'opening', groupKey: 'C60' });
    const inGroup = await seedGame({ stream: 'tournament', eco: 'C60' });
    await seedMistake(inGroup, { halfPointsLost: 2.5 });
    const otherGroup = await seedGame({ stream: 'tournament', eco: 'B01' });
    await seedMistake(otherGroup, { halfPointsLost: 9.0 });

    const body = (await (await get('user_owner', 'tournament')).json()) as {
      patterns: PatternBody[];
    };
    const row = body.patterns.find((p) => p.kind === 'opening')!;
    expect(row.groupKey).toBe('C60');
    expect(row.windowInstances).toBe(1);
    expect(row.windowCost).toBe(2.5);
  });

  test('time trouble counts only mistakes at or under the trouble clock', async () => {
    await seedPattern({ kind: 'time_trouble', groupKey: 'time_trouble' });
    const g = await seedGame({ stream: 'tournament' });
    await seedMistake(g, { halfPointsLost: 1.0, clockMs: TROUBLE_CLOCK_MS });
    await seedMistake(g, { halfPointsLost: 5.0, clockMs: TROUBLE_CLOCK_MS + 1, ply: 7 });
    await seedMistake(g, { halfPointsLost: 3.0, ply: 9 });

    const body = (await (await get('user_owner', 'tournament')).json()) as {
      patterns: PatternBody[];
    };
    const row = body.patterns[0]!;
    expect(row.windowInstances).toBe(1);
    expect(row.windowCost).toBe(1.0);
  });

  test('a came-back row reads its relapse count and its relapse instances', async () => {
    await seedPattern({
      kind: 'motif',
      groupKey: 'hanging_piece',
      state: 'came_back',
      relapses: 2,
    });
    const relapse = await seedGame({ stream: 'tournament', playedAt: PAST(2) });
    await seedMistake(relapse, { motif: 'hanging_piece', halfPointsLost: 2.0 });

    const body = (await (await get('user_owner', 'tournament')).json()) as {
      patterns: PatternBody[];
    };
    const row = body.patterns[0]!;
    expect(row.relapses).toBe(2);
    // The window still runs from masteredAt, so the instances that came
    // back are what the balance shows until the group re-masters.
    expect(row.windowInstances).toBe(1);
    expect(row.windowCost).toBe(2.0);
  });
});

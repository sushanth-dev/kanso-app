/**
 * The motif endpoint against a real PostgreSQL, with fixture games and
 * mistakes in the real tables. The scoring is unit-tested in motifs.test.ts;
 * this covers what only a database proves: the grouping, the analysed-only and
 * per-stream filters, the withholding threshold, and the two empty cases.
 */
import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { game, mistake, player } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';

let harness: IntegrationDatabase;
const OWNER = 'user_owner';

const sessionFor = (userId: string) => () => ({ userId });

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
    .values([{ id: OWNER, name: 'Owner', email: 'owner@example.com', emailVerified: true }]);
});

function app(userId: string | null) {
  return createApp({
    db: harness.db,
    getSession: (userId == null ? () => null : sessionFor(userId)) as (c: Context) => unknown,
  });
}

async function get(userId: string | null, stream: string) {
  return app(userId).request(`/motifs?stream=${stream}`);
}

async function makePlayer(ownerId: string): Promise<string> {
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: ownerId, displayName: 'Sushanth Kamabathula' })
    .returning({ id: player.id });
  return row!.id;
}

let seq = 0;
/** Insert one analysed game. Online and tournament games share the same columns. */
async function seedGame(
  playerId: string,
  fields: Partial<typeof game.$inferInsert> = {},
): Promise<string> {
  const [row] = await harness.db
    .insert(game)
    .values({
      playerId,
      stream: 'tournament',
      source: 'pgn_upload',
      pgnHash: `hash_${playerId}_${seq++}`,
      pgn: '[Result "1-0"]\n\n1. e4 e5 1-0',
      result: '1-0',
      analysisStatus: 'complete',
      ...fields,
    })
    .returning({ id: game.id });
  return row!.id;
}

/** Attach one mistake per entry. `motif` is null for an unattributed mistake. */
async function addMistakes(
  gameId: string,
  rows: { motif: string | null; cpLoss: number }[],
): Promise<void> {
  if (rows.length === 0) return;
  await harness.db.insert(mistake).values(
    rows.map((r, i) => ({
      gameId,
      ply: i + 1,
      moveNumber: i + 1,
      movingColor: 'white' as const,
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      moveSan: 'e4',
      bestMoveSan: 'd4',
      judgement: 'mistake' as const,
      cpLoss: r.cpLoss,
      winProbDrop: 0.2,
      motif: r.motif,
    })),
  );
}

interface MotifReportBody {
  playerId: string;
  stream: string;
  motifs: { motif: string; positions: number; totalCpLoss: number }[];
  unattributed: number;
  mistakeCount: number;
  withheld: number;
}

describe('GET /motifs', () => {
  test('aggregates by motif, ranked by cost, with the unattributed share stated', async () => {
    const playerId = await makePlayer(OWNER);
    await addMistakes(await seedGame(playerId, { stream: 'online' }), [
      { motif: 'hanging_piece', cpLoss: 100 },
      { motif: 'hanging_piece', cpLoss: 100 },
      { motif: 'hanging_piece', cpLoss: 100 },
      { motif: 'missed_capture', cpLoss: 50 },
      { motif: 'missed_capture', cpLoss: 50 },
      { motif: 'missed_capture', cpLoss: 50 },
      { motif: 'missed_capture', cpLoss: 50 },
      { motif: null, cpLoss: 30 },
    ]);

    const res = await get(OWNER, 'online');
    expect(res.status).toBe(200);
    const body = (await res.json()) as MotifReportBody;
    expect(body.motifs).toEqual([
      { motif: 'hanging_piece', positions: 3, totalCpLoss: 300 },
      { motif: 'missed_capture', positions: 4, totalCpLoss: 200 },
    ]);
    expect(body.unattributed).toBe(1);
    expect(body.mistakeCount).toBe(8);
    expect(body.withheld).toBe(0);
  });

  test('withholds a motif under the threshold and reports the withheld count', async () => {
    const playerId = await makePlayer(OWNER);
    await addMistakes(await seedGame(playerId), [
      { motif: 'hanging_piece', cpLoss: 100 },
      { motif: 'hanging_piece', cpLoss: 100 },
      { motif: 'hanging_piece', cpLoss: 100 },
      { motif: 'hanging_piece', cpLoss: 100 },
      { motif: 'missed_check', cpLoss: 100 },
      { motif: 'missed_check', cpLoss: 100 },
      { motif: 'missed_threat', cpLoss: 100 },
    ]);

    const res = await get(OWNER, 'tournament');
    expect(res.status).toBe(200);
    const body = (await res.json()) as MotifReportBody;
    expect(body.motifs).toEqual([{ motif: 'hanging_piece', positions: 4, totalCpLoss: 400 }]);
    expect(body.withheld).toBe(2);
    // Withheld mistakes still count toward the total.
    expect(body.mistakeCount).toBe(7);
    expect(body.unattributed).toBe(0);
  });

  test('never blends streams: each returns its own motifs', async () => {
    const playerId = await makePlayer(OWNER);
    await addMistakes(await seedGame(playerId, { stream: 'online' }), [
      { motif: 'hanging_piece', cpLoss: 100 },
      { motif: 'hanging_piece', cpLoss: 100 },
      { motif: 'hanging_piece', cpLoss: 100 },
    ]);
    await addMistakes(await seedGame(playerId, { stream: 'tournament' }), [
      { motif: 'missed_capture', cpLoss: 100 },
      { motif: 'missed_capture', cpLoss: 100 },
      { motif: 'missed_capture', cpLoss: 100 },
    ]);

    const online = (await (await get(OWNER, 'online')).json()) as MotifReportBody;
    const tournament = (await (await get(OWNER, 'tournament')).json()) as MotifReportBody;
    expect(online.motifs.map((m) => m.motif)).toEqual(['hanging_piece']);
    expect(tournament.motifs.map((m) => m.motif)).toEqual(['missed_capture']);
  });

  test('an unanalysed game does not count toward a motif', async () => {
    const playerId = await makePlayer(OWNER);
    await addMistakes(await seedGame(playerId, { analysisStatus: 'pending' }), [
      { motif: 'hanging_piece', cpLoss: 100 },
      { motif: 'hanging_piece', cpLoss: 100 },
      { motif: 'hanging_piece', cpLoss: 100 },
    ]);

    // No analysed games at all, so this is the empty case, not a thin history.
    const res = await get(OWNER, 'tournament');
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('not_enough_evidence');
  });

  test('a player with no analysed games in the stream answers 422', async () => {
    const playerId = await makePlayer(OWNER);
    // Games exist, but in the other stream.
    await addMistakes(await seedGame(playerId, { stream: 'online' }), [
      { motif: 'hanging_piece', cpLoss: 100 },
      { motif: 'hanging_piece', cpLoss: 100 },
      { motif: 'hanging_piece', cpLoss: 100 },
    ]);

    const res = await get(OWNER, 'tournament');
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('not_enough_evidence');
  });

  test('a player with analysed games and no mistakes is a clean bill, not a refusal', async () => {
    const playerId = await makePlayer(OWNER);
    await seedGame(playerId);

    const res = await get(OWNER, 'tournament');
    expect(res.status).toBe(200);
    const body = (await res.json()) as MotifReportBody;
    expect(body.motifs).toEqual([]);
    expect(body.mistakeCount).toBe(0);
    expect(body.unattributed).toBe(0);
  });
});

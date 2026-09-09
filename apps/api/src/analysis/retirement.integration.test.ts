/**
 * ST-150. The retirement machine against a real PostgreSQL, driven through the
 * same hook `analyseGame` calls: a candidate retires only past the window
 * floor, a relapse flips `retired` to `came_back` exactly once per relapse,
 * regeneration cannot disturb a state row, streams are independent, an advice
 * close-out never promotes a candidate, and an online rapid game never counts
 * toward an online window.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { user } from '../db/auth-schema.ts';
import { game, mistake, movePly, patternState, puzzle, player } from '../db/schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import { applyRetirement } from './retirement.ts';
import { recordDrill } from '../practice/record.ts';

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

/**
 * A game row, analysed at some played date. A mistake on ply 3 is seeded when
 * a motif, phase, or a trouble-clock time is given, matching the game's
 * pattern so `instanceKeysOf` sees it.
 */
async function seedGame(opts: {
  stream?: 'tournament' | 'online';
  playedAt?: Date | null;
  timeControl?: string | null;
  motif?: string;
  clockMs?: number;
}): Promise<string> {
  const { stream = 'tournament', playedAt = PAST(1), timeControl = null, motif, clockMs } = opts;
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
      playedAt,
      timeControl,
      analysisStatus: 'complete',
      eco: 'B01',
      opening: 'Scandinavian',
    })
    .returning({ id: game.id });
  const gid = g!.id;
  await harness.db.insert(movePly).values({
    gameId: gid,
    ply: 3,
    san: 'Qf6',
    uci: 'd8f6',
    fenBefore: 'rnbqkbnr/pppp1ppp/8/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 0 3',
    clockMs: clockMs ?? null,
    evalCp: -300,
  });
  if (motif !== undefined || clockMs !== undefined) {
    await harness.db.insert(mistake).values({
      gameId: gid,
      ply: 3,
      moveNumber: 2,
      movingColor: 'black',
      phase: null,
      fen: 'rnbqkbnr/pppp1ppp/8/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 0 3',
      moveSan: 'Qf6',
      bestMoveSan: 'Nc6',
      judgement: 'blunder',
      cpLoss: 300,
      winProbDrop: 0.2,
      motif: motif ?? null,
    });
  }
  return gid;
}

/** A pattern_state row, candidate by default. */
async function seedPattern(opts: {
  kind: 'opening' | 'motif' | 'phase' | 'time_trouble';
  groupKey: string;
  stream?: 'tournament' | 'online';
  state?: 'candidate' | 'retired';
  masteredDaysAgo?: number;
}): Promise<string> {
  const { kind, groupKey, stream = 'tournament', state = 'candidate', masteredDaysAgo = 30 } = opts;
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
      retiredAt: state === 'retired' ? PAST(5) : null,
    })
    .returning({ id: patternState.id });
  return row!.id;
}

async function rowOf(id: string) {
  const [row] = await harness.db.select().from(patternState).where(eq(patternState.id, id));
  return row!;
}

async function windowGames(count: number, stream: 'tournament' | 'online'): Promise<void> {
  for (let i = 0; i < count; i++) {
    await seedGame({ stream, playedAt: PAST(i + 2) });
  }
}

describe('candidate to retired (ST-150)', () => {
  test('a nine-game window never retires; a clean tenth game does', async () => {
    const id = await seedPattern({ kind: 'motif', groupKey: 'hanging_piece' });
    await windowGames(8, 'tournament');
    const ninth = await seedGame({ stream: 'tournament' });
    await applyRetirement(harness.db, ninth);
    expect((await rowOf(id)).state).toBe('candidate');
    expect((await rowOf(id)).retiredAt).toBeNull();

    const tenth = await seedGame({ stream: 'tournament' });
    await applyRetirement(harness.db, tenth);
    expect((await rowOf(id)).state).toBe('retired');
    expect((await rowOf(id)).retiredAt).not.toBeNull();
  });

  test('games older than masteredAt never count toward the window', async () => {
    const id = await seedPattern({ kind: 'motif', groupKey: 'hanging_piece', masteredDaysAgo: 30 });
    // Nine games before the row was mastered plus the trigger: if a buggy
    // window counted them, this would retire, and it must not.
    for (let i = 0; i < 9; i++) {
      await seedGame({ stream: 'tournament', playedAt: PAST(40 + i) });
    }
    const trigger = await seedGame({ stream: 'tournament', playedAt: PAST(1) });
    await applyRetirement(harness.db, trigger);
    expect((await rowOf(id)).state).toBe('candidate');

    // The first in-window game joins them; still nine short of the floor.
    const fresh = await seedGame({ stream: 'tournament', playedAt: PAST(1) });
    await applyRetirement(harness.db, fresh);
    expect((await rowOf(id)).state).toBe('candidate');
  });

  test('an online rapid game does not count toward an online window', async () => {
    const id = await seedPattern({ kind: 'motif', groupKey: 'hanging_piece', stream: 'online' });
    // Nine blitz plus one rapid, the trigger: the blitz window is nine, below
    // the floor, so the rapid game is the only new material and retires nothing.
    await seedGame({ stream: 'online', timeControl: '180+0', playedAt: PAST(2) });
    for (let i = 0; i < 8; i++) {
      await seedGame({ stream: 'online', timeControl: '180+0', playedAt: PAST(3 + i) });
    }
    await seedGame({ stream: 'online', timeControl: '900+10', playedAt: PAST(11) });
    const trigger = await seedGame({ stream: 'online', timeControl: '900+10', playedAt: PAST(12) });
    await applyRetirement(harness.db, trigger);
    expect((await rowOf(id)).state).toBe('candidate');

    // A tenth blitz game completes the floor and retires the row.
    await seedGame({ stream: 'online', timeControl: '180+0', playedAt: PAST(12) });
    await applyRetirement(harness.db, trigger);
    expect((await rowOf(id)).state).toBe('retired');
  });

  test('a tournament retirement does not retire the online row', async () => {
    const tournamentRow = await seedPattern({ kind: 'motif', groupKey: 'hanging_piece' });
    const onlineRow = await seedPattern({
      kind: 'motif',
      groupKey: 'hanging_piece',
      stream: 'online',
    });
    await windowGames(10, 'tournament');
    const clean = await seedGame({ stream: 'tournament' });
    await applyRetirement(harness.db, clean);
    expect((await rowOf(tournamentRow)).state).toBe('retired');
    expect((await rowOf(onlineRow)).state).toBe('candidate');
  });
});

describe('relapse: retired to came_back (ST-150)', () => {
  test('two instances in one game fire one alert', async () => {
    const id = await seedPattern({ kind: 'motif', groupKey: 'hanging_piece', state: 'retired' });
    // Both mistakes in the same game carry the motif, but the hook runs once
    // per completed game, so the transition happens once.
    await seedGame({ stream: 'tournament', motif: 'hanging_piece' });
    const relapse = await seedGame({ stream: 'tournament', motif: 'hanging_piece' });
    await applyRetirement(harness.db, relapse);
    await applyRetirement(harness.db, relapse);
    const row = await rowOf(id);
    expect(row.state).toBe('came_back');
    expect(row.cameBackAt).not.toBeNull();
    expect(row.lastAlertGameId).toBe(relapse);
  });

  test('a second relapse after re-mastering fires again', async () => {
    const id = await seedPattern({ kind: 'motif', groupKey: 'hanging_piece', state: 'retired' });
    const first = await seedGame({ stream: 'tournament', motif: 'hanging_piece' });
    await applyRetirement(harness.db, first);
    expect((await rowOf(id)).state).toBe('came_back');
    expect((await rowOf(id)).lastAlertGameId).toBe(first);

    // Re-master: the record side flips the row back to candidate, then the
    // window completes and it retires again.
    await harness.db
      .update(patternState)
      .set({ state: 'candidate', cameBackAt: null, lastAlertGameId: null })
      .where(eq(patternState.id, id));
    await windowGames(10, 'tournament');
    const clean = await seedGame({ stream: 'tournament' });
    await applyRetirement(harness.db, clean);
    expect((await rowOf(id)).state).toBe('retired');
    expect((await rowOf(id)).lastAlertGameId).toBeNull();

    const second = await seedGame({ stream: 'tournament', motif: 'hanging_piece' });
    await applyRetirement(harness.db, second);
    expect((await rowOf(id)).state).toBe('came_back');
    expect((await rowOf(id)).lastAlertGameId).toBe(second);
  });

  test('an instance in a candidate row keeps it candidate', async () => {
    const id = await seedPattern({ kind: 'motif', groupKey: 'hanging_piece' });
    await windowGames(10, 'tournament');
    const dirty = await seedGame({ stream: 'tournament', motif: 'hanging_piece' });
    await applyRetirement(harness.db, dirty);
    expect((await rowOf(id)).state).toBe('candidate');
  });
});

describe('regeneration survival (ST-150)', () => {
  test('rewriting mistake rows leaves the state row untouched', async () => {
    const id = await seedPattern({ kind: 'motif', groupKey: 'hanging_piece', state: 'retired' });
    const gid = await seedGame({ stream: 'tournament', motif: 'hanging_piece' });
    // Regeneration = analyse() replacing the mistake rows in its transaction.
    // The state row keys on group identity, not row ids, so nothing in it
    // references the mistakes it was read from.
    await harness.db.delete(mistake).where(eq(mistake.gameId, gid));
    await harness.db.insert(mistake).values({
      gameId: gid,
      ply: 3,
      moveNumber: 2,
      movingColor: 'black',
      phase: null,
      fen: 'rnbqkbnr/pppp1ppp/8/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 0 3',
      moveSan: 'Qf6',
      bestMoveSan: 'Nc6',
      judgement: 'blunder',
      cpLoss: 300,
      winProbDrop: 0.2,
      motif: 'hanging_piece',
    });
    const row = await rowOf(id);
    expect(row.state).toBe('retired');
    expect(row.lastAlertGameId).toBeNull();
  });
});

describe('record-side promotion (ST-150)', () => {
  test('a group whose pool reaches mastered becomes a candidate for both streams', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      lichessId: `h1500_${i}`,
      rating: 1500,
    }));
    await harness.db.insert(puzzle).values(
      rows.map((row) => ({
        lichessId: row.lichessId,
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        moves: 'g1f3 b8c6',
        rating: row.rating,
        themes: ['hangingPiece'],
      })),
    );
    for (const row of rows) {
      // Three solved drills each: the review ladder reaches level 3 on the
      // third, and mastery is level 3 on every puzzle the group has dealt.
      for (let drill = 0; drill < 3; drill++) {
        const outcome = await recordDrill(
          harness.db,
          pid,
          row.lichessId,
          'motif',
          'hanging_piece',
          true,
        );
        expect(outcome).not.toBe('no_such_puzzle');
      }
    }
    const [tournament] = await harness.db
      .select()
      .from(patternState)
      .where(
        and(
          eq(patternState.playerId, pid),
          eq(patternState.kind, 'motif'),
          eq(patternState.groupKey, 'hanging_piece'),
          eq(patternState.stream, 'tournament'),
        ),
      );
    const [online] = await harness.db
      .select()
      .from(patternState)
      .where(
        and(
          eq(patternState.playerId, pid),
          eq(patternState.kind, 'motif'),
          eq(patternState.groupKey, 'hanging_piece'),
          eq(patternState.stream, 'online'),
        ),
      );
    expect(tournament).toMatchObject({ state: 'candidate', label: 'Hanging piece' });
    expect(online).toMatchObject({ state: 'candidate', label: 'Hanging piece' });
  });
});

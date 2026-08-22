import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { player } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import { recordActivity, XP_PER_ACTIVITY_DAY } from './activity.ts';

let harness: IntegrationDatabase;
const OWNER = 'user_owner';

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
});

async function seedPlayer(): Promise<string> {
  await harness.db
    .insert(user)
    .values({ id: OWNER, name: 'Owner', email: 'owner@example.com', emailVerified: true })
    .onConflictDoNothing();
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: OWNER, displayName: 'Owner' })
    .returning({ id: player.id });
  return row!.id;
}

async function readPlayer(playerId: string) {
  const [row] = await harness.db.select().from(player).where(eq(player.id, playerId));
  return row!;
}

describe('recordActivity', () => {
  test('the first recorded day sets the streak to one and awards xp', async () => {
    const playerId = await seedPlayer();
    await recordActivity(harness.db, playerId);
    const row = await readPlayer(playerId);
    expect(row.currentStreak).toBe(1);
    expect(row.xp).toBe(XP_PER_ACTIVITY_DAY);
    expect(row.lastActivityDate).not.toBeNull();
  });

  test('a second call the same day does not double-count', async () => {
    const playerId = await seedPlayer();
    await recordActivity(harness.db, playerId);
    await recordActivity(harness.db, playerId);
    const row = await readPlayer(playerId);
    expect(row.currentStreak).toBe(1);
    expect(row.xp).toBe(XP_PER_ACTIVITY_DAY);
  });

  test('a gap of more than one day resets the streak to one, but still awards xp', async () => {
    const playerId = await seedPlayer();
    await harness.db
      .update(player)
      .set({ currentStreak: 5, xp: 50, lastActivityDate: '2020-01-01' })
      .where(eq(player.id, playerId));

    await recordActivity(harness.db, playerId);

    const row = await readPlayer(playerId);
    expect(row.currentStreak).toBe(1);
    expect(row.xp).toBe(60);
  });

  test('a one-day gap extends the streak', async () => {
    const playerId = await seedPlayer();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await harness.db
      .update(player)
      .set({ currentStreak: 3, xp: 30, lastActivityDate: yesterday })
      .where(eq(player.id, playerId));

    await recordActivity(harness.db, playerId);

    const row = await readPlayer(playerId);
    expect(row.currentStreak).toBe(4);
    expect(row.xp).toBe(40);
  });
});

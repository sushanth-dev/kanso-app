/**
 * ST-107. A weakness group's curriculum: three model-assigned resources (one
 * Beginner, one Intermediate, one Advanced) that close the gap the weakness
 * names, and the record of the one the player's assessment proved.
 *
 * Rows key on (player, kind, group key, resource index) - the identity that
 * survives report regeneration - and carry the tier tag the model prefixed.
 * Assignment is idempotent per group: an `ON CONFLICT DO NOTHING` insert
 * means a regeneration or a re-read never rewrites an existing set, and the
 * model only ever sees weaknesses whose set is missing, so a filled
 * curriculum costs no model calls. The `avoid` list is the player's recent
 * assignments, the prototype's dedupe of "the same book three weaknesses in
 * a row".
 *
 * Completion flips one row pending-to-completed with an UPDATE ... WHERE
 * status = 'pending' RETURNING; the XP award runs in the same transaction,
 * so a verdict that pays is a verdict that stored, and a re-submission finds
 * zero rows and pays nothing - the prototype's PENDING-to-COMPLETED guard,
 * expressed as SQL instead of a status check.
 *
 * ponytail: `readItemsByGroup` reads the player's whole action-item table and
 * filters in memory, the same one-indexed-read shape the report's drill
 * counts use. A curriculum is a shelf, not a move log; add a key-set filter
 * if a shelf ever grows past a page.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WeaknessKind } from '../analysis/leak.ts';
import type { AiClient, ResourceRequest } from '../coaching/zai.ts';
import * as schema from '../db/schema.ts';
import { actionItem, player } from '../db/schema.ts';

type Db = PostgresJsDatabase<typeof schema>;

/** The prototype's award for one verified item (`award_curriculum_xp`). */
export const XP_PER_VERIFIED_RESOURCE = 100;

/** How many days the player has to work through an assigned resource. */
const DUE_IN_DAYS = 7;

/** How many recent assignments the model is told not to repeat. */
const AVOID_LIMIT = 20;

/** One weakness whose curriculum needs filling, resolved to its stable key. */
export interface ItemRequest {
  kind: WeaknessKind;
  label: string;
  eco: string | null;
  groupKey: string;
  advice: string | null;
}

/** One stored action item as the report and curriculum pages receive it. */
export interface ItemRow {
  id: string;
  kind: WeaknessKind;
  groupKey: string;
  label: string;
  resourceIndex: number;
  tier: 'beginner' | 'intermediate' | 'advanced';
  resource: string;
  status: 'pending' | 'completed';
  summary: string | null;
  dueAt: Date;
  completedAt: Date | null;
  createdAt: Date;
}

const TIER_BY_TAG: Record<string, ItemRow['tier']> = {
  beginner: 'beginner',
  intermediate: 'intermediate',
  advanced: 'advanced',
};

/** The tier a resource's `[Beginner]`-style prefix names, or null without one. */
export function tierOf(resource: string): ItemRow['tier'] | null {
  const tag = resource
    .trim()
    .toLowerCase()
    .match(/^\[(\w+)\]/)?.[1];
  return tag === undefined ? null : (TIER_BY_TAG[tag] ?? null);
}

/** The stored items for one player's weakness groups, keyed `kind:groupKey`. */
export async function readItemsByGroup(
  db: Db,
  playerId: string,
  groups: Array<{ kind: WeaknessKind; groupKey: string }>,
): Promise<Map<string, ItemRow[]>> {
  const wanted = new Set(groups.map((g) => `${g.kind}:${g.groupKey}`));
  if (wanted.size === 0) return new Map();
  const rows = await db.select().from(actionItem).where(eq(actionItem.playerId, playerId));
  const byGroup = new Map<string, ItemRow[]>();
  for (const row of rows) {
    const key = `${row.kind}:${row.groupKey}`;
    if (!wanted.has(key)) continue;
    byGroup.set(key, [...(byGroup.get(key) ?? []), row]);
  }
  for (const list of byGroup.values()) list.sort((a, b) => a.resourceIndex - b.resourceIndex);
  return byGroup;
}

/**
 * Fill any weakness group whose curriculum is missing: one model call for
 * the whole report, one idempotent insert per resource. Weaknesses whose
 * set already exists are left alone and cost nothing; with no model there
 * is nothing to fill, and the caller serves the empty set.
 */
export async function ensureActionItems(
  db: Db,
  ai: AiClient | null,
  playerId: string,
  requests: ItemRequest[],
): Promise<void> {
  if (ai === null || requests.length === 0) return;

  const existing = await readItemsByGroup(
    db,
    playerId,
    requests.map((r) => ({ kind: r.kind, groupKey: r.groupKey })),
  );
  const missing = requests.filter(
    (r) => (existing.get(`${r.kind}:${r.groupKey}`) ?? []).length === 0,
  );
  if (missing.length === 0) return;

  const [ratingRow] = await db
    .select({
      fideRating: player.fideRating,
      uscfRating: player.uscfRating,
      chesscomRating: player.chesscomRating,
      lichessRating: player.lichessRating,
    })
    .from(player)
    .where(eq(player.id, playerId))
    .limit(1);
  const rating =
    ratingRow?.fideRating ??
    ratingRow?.uscfRating ??
    ratingRow?.chesscomRating ??
    ratingRow?.lichessRating ??
    1500;

  const recent = await db
    .select({ resource: actionItem.resource })
    .from(actionItem)
    .where(eq(actionItem.playerId, playerId))
    .orderBy(desc(actionItem.createdAt))
    .limit(AVOID_LIMIT);
  const avoid = [...new Set(recent.map((r) => r.resource.trim().toLowerCase()))];

  const ask: ResourceRequest[] = missing.map((r) => ({
    kind: r.kind,
    label: r.label,
    eco: r.eco,
    advice: r.advice,
    rating,
  }));
  let sets: string[][];
  try {
    sets = await ai.recommendResources(ask, avoid);
  } catch {
    // The prototype's rule: a failed assignment leaves the curriculum empty
    // rather than inventing resources. The next read retries.
    return;
  }

  const dueAt = new Date(Date.now() + DUE_IN_DAYS * 24 * 60 * 60 * 1000);
  const values = missing.flatMap((request, index) =>
    sets[index]!.map((resource, resourceIndex) => ({
      playerId,
      kind: request.kind,
      groupKey: request.groupKey,
      label: request.label,
      resourceIndex,
      tier: tierOf(resource) ?? TIER_BY_TAG[`${resourceIndex}`] ?? 'intermediate',
      resource,
      dueAt,
    })),
  );
  if (values.length === 0) return;
  await db
    .insert(actionItem)
    .values(values)
    .onConflictDoNothing({
      target: [actionItem.playerId, actionItem.kind, actionItem.groupKey, actionItem.resourceIndex],
    });
}

export type ItemCompletion =
  | { outcome: 'no_such_item' }
  | { outcome: 'already_done'; completedAt: Date | null }
  | { outcome: 'completed'; completedAt: Date };

/**
 * Store an accepted assessment and pay the award exactly once. The update
 * only matches a pending row, so a re-submission transitions nothing, pays
 * nothing, and reports the row's original completion time.
 */
export async function completeItem(
  db: Db,
  playerId: string,
  actionItemId: string,
  summary: string,
): Promise<ItemCompletion> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: actionItem.status, completedAt: actionItem.completedAt })
      .from(actionItem)
      .where(and(eq(actionItem.id, actionItemId), eq(actionItem.playerId, playerId)))
      .limit(1);
    if (row === undefined) return { outcome: 'no_such_item' };
    if (row.status === 'completed') {
      return { outcome: 'already_done', completedAt: row.completedAt };
    }

    const updated = await tx
      .update(actionItem)
      .set({ status: 'completed', summary, completedAt: sql`now()` })
      .where(and(eq(actionItem.id, actionItemId), eq(actionItem.status, 'pending')))
      .returning({ completedAt: actionItem.completedAt });
    if (updated.length === 0) {
      // Another submission got there first; its completion time is the truth.
      const [winner] = await tx
        .select({ completedAt: actionItem.completedAt })
        .from(actionItem)
        .where(eq(actionItem.id, actionItemId))
        .limit(1);
      return { outcome: 'already_done', completedAt: winner?.completedAt ?? null };
    }
    await tx
      .update(player)
      .set({ xp: sql`${player.xp} + ${XP_PER_VERIFIED_RESOURCE}` })
      .where(eq(player.id, playerId));
    return { outcome: 'completed', completedAt: updated[0]!.completedAt! };
  });
}

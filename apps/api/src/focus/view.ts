/**
 * The focus read models: a catalogue entry and an active focus.
 *
 * `toActiveFocus` derives `unverified` from `catalogue === null` rather than
 * reading a stored flag, so the two cannot disagree (F13). `measurements` is
 * passed in by the caller, one entry per stream the focus can be measured in.
 */
import { z } from '@hono/zod-openapi';
import { ActiveFocus, FocusCatalogueEntry, FocusMeasurement } from '../contract/schemas.ts';
import type { focusCatalogue, playerFocus } from '../db/schema.ts';

type CatalogueRow = typeof focusCatalogue.$inferSelect;
type PlayerFocusRow = typeof playerFocus.$inferSelect;

export function toCatalogueEntry(row: CatalogueRow): z.infer<typeof FocusCatalogueEntry> {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    description: row.description,
    measureDescription: row.measureDescription,
    measurableStreams: row.measurableStreams,
    version: row.version,
  };
}

export function toActiveFocus(
  row: Pick<PlayerFocusRow, 'id' | 'source' | 'coachInstruction' | 'pairedFocusId' | 'startedAt'>,
  catalogue: z.infer<typeof FocusCatalogueEntry> | null,
  measurements: z.infer<typeof FocusMeasurement>[],
): z.infer<typeof ActiveFocus> {
  return {
    id: row.id,
    source: row.source,
    catalogue,
    coachInstruction: row.coachInstruction,
    unverified: catalogue === null,
    pairedFocusId: row.pairedFocusId,
    startedAt: row.startedAt.toISOString(),
    measurements,
  };
}

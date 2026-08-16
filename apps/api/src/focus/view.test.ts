import { describe, expect, test } from 'vitest';
import { z } from '@hono/zod-openapi';
import { FocusCatalogueEntry } from '../contract/schemas.ts';
import type { playerFocus } from '../db/schema.ts';
import { toActiveFocus } from './view.ts';

const row: Pick<
  typeof playerFocus.$inferSelect,
  'id' | 'source' | 'coachInstruction' | 'pairedFocusId' | 'startedAt'
> = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  source: 'coach',
  coachInstruction: 'Work on the clock.',
  pairedFocusId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  startedAt: new Date('2026-08-16T00:00:00.000Z'),
};

const catalogue: z.infer<typeof FocusCatalogueEntry> = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  key: 'tactical_alertness',
  title: 'Tactical alertness',
  description: 'Spotting the tactical motifs a position offers.',
  measureDescription: 'The tactical motifs missed.',
  measurableStreams: ['tournament', 'online'],
  version: 1,
};

describe('toActiveFocus', () => {
  test('derives unverified from a null catalogue', () => {
    expect(toActiveFocus(row, null, []).unverified).toBe(true);
    expect(toActiveFocus(row, catalogue, []).unverified).toBe(false);
  });

  test('passes measurements through untouched', () => {
    expect(toActiveFocus(row, catalogue, []).measurements).toEqual([]);
  });

  test('serialises startedAt as ISO', () => {
    expect(toActiveFocus(row, catalogue, []).startedAt).toBe('2026-08-16T00:00:00.000Z');
  });
});

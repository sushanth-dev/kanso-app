import { describe, expect, test } from 'vitest';
import { z } from '@hono/zod-openapi';
import { SetFocus } from '../contract/schemas.ts';
import { resolveFocusFields } from './resolve.ts';

type SetFocusBody = z.infer<typeof SetFocus>;

const IDS: Record<string, string> = {
  converting_won_positions: '11111111-1111-4111-8111-111111111111',
  tactical_alertness: '22222222-2222-4222-8222-222222222222',
};

const resolveKey = (key: string) => Promise.resolve(IDS[key] ?? null);

describe('resolveFocusFields', () => {
  test('a recommended focus resolves its catalogue key', async () => {
    const body: SetFocusBody = { source: 'recommended', catalogueKey: 'converting_won_positions' };
    expect(await resolveFocusFields(body, resolveKey)).toEqual({
      ok: true,
      focus: {
        catalogueId: IDS.converting_won_positions,
        coachInstruction: null,
        pairedFocusId: null,
      },
    });
  });

  test('a self focus resolves its catalogue key', async () => {
    const body: SetFocusBody = { source: 'self', catalogueKey: 'tactical_alertness' };
    const result = await resolveFocusFields(body, resolveKey);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.focus.catalogueId).toBe(IDS.tactical_alertness);
  });

  test('an unknown catalogue key fails for recommended and self', async () => {
    const body: SetFocusBody = { source: 'recommended', catalogueKey: 'nope' };
    expect(await resolveFocusFields(body, resolveKey)).toEqual({ ok: false });
  });

  test('a coach instruction leaves catalogueId null and pairs a measurable focus', async () => {
    const body: SetFocusBody = {
      source: 'coach',
      coachInstruction: 'Work on seeing the tactics you miss.',
      pairedCatalogueKey: 'tactical_alertness',
    };
    expect(await resolveFocusFields(body, resolveKey)).toEqual({
      ok: true,
      focus: {
        catalogueId: null,
        coachInstruction: 'Work on seeing the tactics you miss.',
        pairedFocusId: IDS.tactical_alertness,
      },
    });
  });

  test('a coach instruction that names a catalogue key resolves it too', async () => {
    const body: SetFocusBody = {
      source: 'coach',
      catalogueKey: 'converting_won_positions',
      coachInstruction: 'Work on converting.',
      pairedCatalogueKey: 'tactical_alertness',
    };
    const result = await resolveFocusFields(body, resolveKey);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.focus.catalogueId).toBe(IDS.converting_won_positions);
      expect(result.focus.coachInstruction).toBe('Work on converting.');
      expect(result.focus.pairedFocusId).toBe(IDS.tactical_alertness);
    }
  });

  test('a coach instruction with an unknown paired key fails', async () => {
    const body: SetFocusBody = {
      source: 'coach',
      coachInstruction: 'Work on the clock.',
      pairedCatalogueKey: 'nope',
    };
    expect(await resolveFocusFields(body, resolveKey)).toEqual({ ok: false });
  });

  test('a coach instruction with a present but unknown catalogue key fails', async () => {
    const body: SetFocusBody = {
      source: 'coach',
      catalogueKey: 'nope',
      coachInstruction: 'Work on the clock.',
      pairedCatalogueKey: 'tactical_alertness',
    };
    expect(await resolveFocusFields(body, resolveKey)).toEqual({ ok: false });
  });
});

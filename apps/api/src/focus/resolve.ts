/**
 * F10, F13. Turns a validated `SetFocus` body into the `player_focus` columns,
 * resolving catalogue keys to ids through the injected lookup so the branching
 * is testable without a database.
 *
 * The coach branch always requires a paired measurable focus (a loop that
 * cannot close is not a loop). It stores the instruction verbatim and leaves
 * `catalogueId` null when it names no catalogue key, which is the F13 case.
 */
import { z } from '@hono/zod-openapi';
import { SetFocus } from '../contract/schemas.ts';

type SetFocusBody = z.infer<typeof SetFocus>;

export interface ResolvedFocus {
  catalogueId: string | null;
  coachInstruction: string | null;
  pairedFocusId: string | null;
}

export type ResolveResult = { ok: true; focus: ResolvedFocus } | { ok: false };

export async function resolveFocusFields(
  body: SetFocusBody,
  resolveKey: (key: string) => Promise<string | null>,
): Promise<ResolveResult> {
  if (body.source === 'coach') {
    const pairedFocusId = await resolveKey(body.pairedCatalogueKey);
    if (pairedFocusId === null) return { ok: false };

    const catalogueId =
      body.catalogueKey !== undefined ? await resolveKey(body.catalogueKey) : null;
    if (body.catalogueKey !== undefined && catalogueId === null) return { ok: false };

    return {
      ok: true,
      focus: { catalogueId, coachInstruction: body.coachInstruction, pairedFocusId },
    };
  }

  const catalogueId = await resolveKey(body.catalogueKey);
  if (catalogueId === null) return { ok: false };
  return { ok: true, focus: { catalogueId, coachInstruction: null, pairedFocusId: null } };
}

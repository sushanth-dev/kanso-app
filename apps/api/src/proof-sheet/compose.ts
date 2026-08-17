/**
 * ST-037. The proof sheet composer: the decisions that turn an active focus and
 * its measurements into a frozen `SharedProofSheet`.
 *
 * Four decisions are recorded in ADR-0037 and live here as pure functions:
 * which stream to share, how before and after map to the two halves, what the
 * refusal case says, and the token's source. Keeping them pure means the
 * decisions are pinned by unit tests rather than buried in a handler.
 */
import { randomBytes } from 'node:crypto';
import { z } from '@hono/zod-openapi';
import { SharedProofSheet, Stream } from '../contract/schemas.ts';
import type { FocusTrend } from '../focus/verify.ts';

export type ProofSheetStream = z.infer<typeof Stream>;

export interface MeasuredStream {
  stream: ProofSheetStream;
  unit: string;
  trend: FocusTrend;
  windowGames: number;
  gamesBefore: number;
  baselineValue: number | null;
  currentValue: number | null;
  periodStart: Date | null;
  periodEnd: Date | null;
}

/**
 * Pick the stream the sheet freezes. A verdict beats a refusal; among verdicts
 * (all at ten games) the catalogue's declared order decides; if every stream
 * refuses, the most evidenced (largest `windowGames`) then declared order
 * decides. The input is in `measurableStreams` order and the sort is stable, so
 * the tie-break is the catalogue's order without a second comparison.
 */
export function pickStream(measurements: MeasuredStream[]): MeasuredStream {
  const ranked = [...measurements].sort((a, b) => {
    const aVerdict = a.trend === 'insufficient_evidence' ? 0 : 1;
    const bVerdict = b.trend === 'insufficient_evidence' ? 0 : 1;
    if (aVerdict !== bVerdict) return bVerdict - aVerdict;
    if (a.windowGames !== b.windowGames) return b.windowGames - a.windowGames;
    return 0;
  });
  return ranked[0]!;
}

/** The share secret. Long, random, and the only access control on the page. */
export function generateToken(): string {
  // 32 bytes -> 43 base64url characters, comfortably past the declared 32.
  return randomBytes(32).toString('base64url');
}

/**
 * Compose the frozen page. `beforeValue`/`afterValue` are the two halves'
 * values, `gamesBefore`/`gamesAfter` their sizes, and the period is the span of
 * the evidence. A focus with no verdict is served honestly: the values are null
 * and the trend is `insufficient_evidence`, with the games behind it still
 * stated. The period falls back to the commitment date when a half is empty.
 */
export function composeSharedProofSheet(input: {
  playerDisplayName: string;
  focusTitle: string;
  coachInstruction: string | null;
  startedAt: Date;
  measurements: MeasuredStream[];
}): { stream: ProofSheetStream; snapshot: z.infer<typeof SharedProofSheet> } {
  const picked = pickStream(input.measurements);
  return {
    stream: picked.stream,
    snapshot: {
      playerDisplayName: input.playerDisplayName,
      focusTitle: input.focusTitle,
      coachInstruction: input.coachInstruction,
      stream: picked.stream,
      unit: picked.unit,
      beforeValue: picked.baselineValue,
      afterValue: picked.currentValue,
      trend: picked.trend,
      gamesBefore: picked.gamesBefore,
      gamesAfter: picked.windowGames,
      periodStart: (picked.periodStart ?? input.startedAt).toISOString(),
      periodEnd: (picked.periodEnd ?? input.startedAt).toISOString(),
    },
  };
}

/**
 * ST-100. The report's opening plan: one model-written summary of what to do
 * about the ranked weaknesses, generated when the report regenerates and
 * stored in `report.narrative` - the column ADR-0018 reserved for report
 * prose, null until now. The guardrails are the seam's standing rules shared
 * with `advice.ts` (facts only, mechanical validation, one corrective retry);
 * the fallback on failure is null and an unrendered block, because a template
 * for a plan that names nothing specific is the canned text ADR-0018 forbids.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { AiClient, ReportSummaryFacts } from '../coaching/zai.ts';
import type * as schema from '../db/schema.ts';
import type { ComposedWeakness } from './compose.ts';
import { textWithinFacts } from './advice.ts';
import { groupKeyOf, weaknessEvidence } from './evidence.ts';

type Db = PostgresJsDatabase<typeof schema>;
type Stream = (typeof schema.streamEnum.enumValues)[number];

/** Enough to name a plan, small enough to read at a glance. */
const MAX_SUMMARY_SENTENCES = 3;

export function summaryIsValid(text: string, facts: ReportSummaryFacts): boolean {
  const allowedNumbers = new Set<string>();
  const allowedSans = new Set<string>();
  allowedNumbers.add(String(facts.gamesCovered));
  if (facts.timeTroubleFromMove !== null) allowedNumbers.add(String(facts.timeTroubleFromMove));
  for (const w of facts.weaknesses) {
    allowedNumbers.add(String(w.occurrences));
    allowedNumbers.add(String(w.halfPointsLost));
    allowedNumbers.add(String(w.gamesAffected));
    allowedNumbers.add(String(w.ratingLeak));
    // An ECO code reaches the prompt as data, so its digits may appear in the
    // plan the same way any other fact's numbers may.
    for (const n of w.eco?.match(/\d+/g) ?? []) allowedNumbers.add(n);
    for (const instance of w.instances) {
      allowedNumbers.add(String(instance.moveNumber));
      allowedNumbers.add(String(instance.cpLoss));
      allowedSans.add(instance.moveSan);
      allowedSans.add(instance.bestMoveSan);
    }
  }
  return textWithinFacts(text, allowedNumbers, allowedSans, MAX_SUMMARY_SENTENCES);
}

/**
 * The stored summary for one report generation, or null when the model
 * cannot write one that stays inside the facts. A thrown first attempt is
 * not retried, matching the advice ladder: a provider that is down does not
 * get a second chance to stall the report.
 */
export async function summaryForReport(
  db: Db,
  ai: AiClient,
  input: {
    playerId: string;
    stream: Stream;
    tournamentId: string | undefined;
    windowStart: Date;
    gamesCovered: number;
    timeTroubleFromMove: number | null;
    weaknesses: ComposedWeakness[];
    advice: ReadonlyMap<string, string>;
  },
): Promise<string | null> {
  const keyed = input.weaknesses.map((w) => ({ w, key: groupKeyOf(w.kind, w.label, w.eco) }));
  const withKeys = keyed.filter((g): g is typeof g & { key: string } => g.key !== null);
  if (keyed.length === 0) return null;

  // weaknessEvidence early-returns an empty map for an empty group list, so
  // the call is unconditional even when every key was null.
  const evidence = await weaknessEvidence(
    db,
    input.playerId,
    input.stream,
    input.tournamentId,
    input.windowStart,
    withKeys.map((g) => ({ kind: g.w.kind, key: g.key })),
  );

  const facts: ReportSummaryFacts = {
    gamesCovered: input.gamesCovered,
    timeTroubleFromMove: input.timeTroubleFromMove,
    weaknesses: keyed.map(({ w, key }) => ({
      kind: w.kind,
      label: w.label,
      eco: w.eco,
      occurrences: w.occurrences,
      halfPointsLost: w.halfPointsLost,
      gamesAffected: w.gamesAffected,
      ratingLeak: w.ratingLeak,
      saturated: w.saturated,
      advice: key === null ? null : (input.advice.get(`${w.kind}:${key}`) ?? null),
      instances:
        key === null
          ? []
          : (evidence.get(`${w.kind}:${key}`) ?? []).map((e) => ({
              moveNumber: e.moveNumber,
              moveSan: e.moveSan,
              bestMoveSan: e.bestMoveSan,
              judgement: e.judgement,
              cpLoss: e.cpLoss,
            })),
    })),
  };

  return generateSummary(ai, facts);
}

/**
 * One model attempt, then at most one corrective retry. A thrown first call
 * is not retried, matching the advice ladder: a provider that is down does
 * not get a second chance to stall the report.
 */
export async function generateSummary(
  ai: AiClient,
  facts: ReportSummaryFacts,
): Promise<string | null> {
  let first: string;
  try {
    first = await ai.summarizeReport(facts);
  } catch {
    return null;
  }
  if (summaryIsValid(first, facts)) return first.trim();

  try {
    const second = await ai.summarizeReport(facts);
    if (summaryIsValid(second, facts)) return second.trim();
  } catch {
    return null;
  }
  return null;
}

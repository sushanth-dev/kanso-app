/**
 * ST-099, ADR-0018's third call site: one model-written advice line per
 * report weakness, grounded in the same instances the card shows beneath it.
 *
 * The guardrails mirror the seam's contract in `coaching/gemini.ts`: the
 * prompt carries facts only (no FEN, no names, no ids - opening weaknesses
 * are excluded outright, so no PGN-derived string ever reaches the model),
 * and the output is validated mechanically. Every number and every SAN token
 * in the model's text must appear in the fact set it was given, and the line
 * is capped at two sentences; the mismatch Sushanth caught in the ST-098
 * post-merge fix ("moves 10-25" over instances at 27-46) is exactly what this
 * check rejects. One corrective retry, then the template copy from
 * `evidence.ts` - a deliberate deviation from ADR-0018's "never canned text"
 * rule, recorded in the story: the report must not fail because a garnish
 * failed, and the templates claim nothing about the position.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { AiClient, ReportAdviceFacts } from '../coaching/gemini.ts';
import type * as schema from '../db/schema.ts';
import type { ComposedWeakness } from './compose.ts';
import { groupKeyOf, weaknessEvidence } from './evidence.ts';

type Db = PostgresJsDatabase<typeof schema>;
type Stream = (typeof schema.streamEnum.enumValues)[number];

/** SAN-shaped tokens; membership in the fact set is checked separately. */
const SAN_PATTERN =
  /\b(?:[O0]-[O0](?:-[O0])?[+#]?|[KQRBN][a-h1-8]?x?[a-h][1-8](?:=[KQRBN])?[+#]?|[a-h]x[a-h][1-8](?:=[KQRBN])?[+#]?|[a-h][1-8](?:=[KQRBN])?[+#]?)\b/g;

// ponytail: the number and SAN allowlists catch invented facts, the only bug
// class that bit us. Semantic nonsense ("your queen is trapped" with no
// queen) still passes; upgrade to an engine cross-check if that ever shows
// up in practice.
export function adviceIsValid(text: string, facts: ReportAdviceFacts): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return false;
  if ((trimmed.match(/[.!?]/g) ?? []).length > 2) return false;

  const allowedNumbers = new Set<string>();
  for (const instance of facts.instances) {
    allowedNumbers.add(String(instance.moveNumber));
    allowedNumbers.add(String(instance.cpLoss));
  }
  allowedNumbers.add(String(facts.occurrences));
  allowedNumbers.add(String(facts.halfPointsLost));
  allowedNumbers.add(String(facts.gamesAffected));
  allowedNumbers.add(String(facts.gamesCovered));
  allowedNumbers.add(String(facts.ratingLeak));

  const numbers = trimmed.match(/\d+(?:\.\d+)?/g) ?? [];
  if (numbers.some((n) => !allowedNumbers.has(n))) return false;

  const allowedSans = new Set(facts.instances.flatMap((i) => [i.moveSan, i.bestMoveSan]));
  const sans = trimmed.match(SAN_PATTERN) ?? [];
  if (sans.some((san) => !allowedSans.has(san))) return false;

  return true;
}

/**
 * One model attempt per weakness, then at most one corrective retry for the
 * lines that failed validation. A thrown call is not retried: a provider
 * that is down does not get a second chance to stall the report, and the
 * cards simply keep the template copy.
 */
export async function generateAdvice(
  ai: AiClient,
  facts: ReportAdviceFacts[],
): Promise<(string | null)[]> {
  let first: string[] | null = null;
  try {
    first = await ai.adviseWeaknesses(facts);
  } catch {
    return facts.map(() => null);
  }

  const out = facts.map((f, i) => {
    const line = first[i];
    return typeof line === 'string' && adviceIsValid(line, f) ? line.trim() : null;
  });

  const failed = facts.map((_, i) => i).filter((i) => out[i] === null);
  if (failed.length === 0) return out;

  let second: string[];
  try {
    second = await ai.adviseWeaknesses(failed.map((i) => facts[i]!));
  } catch {
    return out;
  }
  for (const [j, i] of failed.entries()) {
    const line = second[j];
    if (typeof line === 'string' && adviceIsValid(line, facts[i]!)) out[i] = line.trim();
  }
  return out;
}

/**
 * The model lines for one report generation, keyed by the aggregate key the
 * stored weakness rows carry (`${kind}:${key}`). Weaknesses the model cannot
 * write for - openings, which have no template advice either, or groups the
 * model failed or refused - are simply absent, and the serve path falls back
 * to the template copy.
 */
export async function adviceForReport(
  db: Db,
  ai: AiClient,
  input: {
    playerId: string;
    stream: Stream;
    tournamentId: string | undefined;
    windowStart: Date;
    gamesCovered: number;
    weaknesses: ComposedWeakness[];
  },
): Promise<Map<string, string>> {
  const groups = input.weaknesses
    .filter(
      (w): w is ComposedWeakness & { kind: 'motif' | 'phase' | 'time_trouble' } =>
        w.kind !== 'opening',
    )
    .map((w) => ({ w, key: groupKeyOf(w.kind, w.label, w.eco) }))
    .filter((g): g is { w: typeof g.w; key: string } => g.key !== null);
  if (groups.length === 0) return new Map();

  const evidence = await weaknessEvidence(
    db,
    input.playerId,
    input.stream,
    input.tournamentId,
    input.windowStart,
    groups.map((g) => ({ kind: g.w.kind, key: g.key })),
  );

  const facts: ReportAdviceFacts[] = groups.map((g) => ({
    kind: g.w.kind,
    label: g.w.label,
    occurrences: g.w.occurrences,
    halfPointsLost: g.w.halfPointsLost,
    gamesAffected: g.w.gamesAffected,
    ratingLeak: g.w.ratingLeak,
    saturated: g.w.saturated,
    gamesCovered: input.gamesCovered,
    instances: (evidence.get(`${g.w.kind}:${g.key}`) ?? []).map((e) => ({
      moveNumber: e.moveNumber,
      moveSan: e.moveSan,
      bestMoveSan: e.bestMoveSan,
      judgement: e.judgement,
      cpLoss: e.cpLoss,
    })),
  }));

  const lines = await generateAdvice(ai, facts);
  const out = new Map<string, string>();
  for (const [i, g] of groups.entries()) {
    const line = lines[i];
    if (line) out.set(`${g.w.kind}:${g.key}`, line);
  }
  return out;
}

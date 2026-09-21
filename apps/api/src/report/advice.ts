/**
 * ST-099, ADR-0018's third call site: one model-written advice line per
 * report weakness, grounded in the same instances the card shows beneath it.
 * Written once, at the click that opens the weakness, and stored on the
 * weakness row - never in bulk across a report.
 *
 * The guardrails mirror the seam's contract in `coaching/zai.ts`: the
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
 *
 * ST-177 carries the same rule to the coaching routes, which stored whatever
 * the model returned: `mistakeFactTokens` builds the allowlists for one
 * `MistakeFacts` the way `adviceIsValid` builds its own, and
 * `checkTextWithinFacts` reports why a text failed so the route can log it.
 */
import type { AiClient, ReportAdviceFacts, MistakeFacts } from '../coaching/zai.ts';
import { mateDistance, pawnsMagnitude } from '../coaching/zai.ts';

/** SAN-shaped tokens; membership in the fact set is checked separately. */
const SAN_PATTERN =
  /\b(?:[O0]-[O0](?:-[O0])?[+#]?|[KQRBN][a-h1-8]?x?[a-h][1-8](?:=[KQRBN])?[+#]?|[a-h]x[a-h][1-8](?:=[KQRBN])?[+#]?|[a-h][1-8](?:=[KQRBN])?[+#]?)\b/g;

/** Numbers as a reply writes them; the sign is not part of the token. */
const NUMBER_PATTERN = /\d+(?:\.\d+)?/g;

const SENTENCE_PATTERN = /[.!?]/g;

// ponytail: the number and SAN allowlists catch invented facts, the only bug
// class that bit us. Semantic nonsense ("your queen is trapped" with no
// queen) still passes; upgrade to an engine cross-check if that ever shows
// up in practice.
export function textWithinFacts(
  text: string,
  allowedNumbers: ReadonlySet<string>,
  allowedSans: ReadonlySet<string>,
  maxSentences: number,
): boolean {
  return checkTextWithinFacts(text, allowedNumbers, allowedSans, maxSentences) === null;
}

/** Why a text cannot be served: it is empty, it runs long, or it invents a fact. */
export type FactCheckFailure =
  { reason: 'empty' } | { reason: 'sentences' } | { reason: 'token'; token: string };

/**
 * ST-099, ST-177. The rule as a reason rather than a boolean, so a caller can
 * log which token a reply invented instead of only that it failed. ST-177's
 * rejection rate is read from those lines.
 */
export function checkTextWithinFacts(
  text: string,
  allowedNumbers: ReadonlySet<string>,
  allowedSans: ReadonlySet<string>,
  maxSentences: number,
): FactCheckFailure | null {
  const trimmed = text.trim();
  if (trimmed === '') return { reason: 'empty' };
  if ((trimmed.match(SENTENCE_PATTERN) ?? []).length > maxSentences) return { reason: 'sentences' };

  // A move carries digits that are not claims about a number: `Qf6` prints a
  // 6, `e4` a 4. The number scan therefore reads the text with its SAN tokens
  // blanked, or every faithful reply that names the move would be rejected for
  // inventing the rank. The SAN check below still reads the raw text, which is
  // what catches a move that was never in the facts.
  const withoutSans = trimmed.replace(SAN_PATTERN, ' ');
  const number = (withoutSans.match(NUMBER_PATTERN) ?? []).find((n) => !allowedNumbers.has(n));
  if (number !== undefined) return { reason: 'token', token: number };

  const san = (trimmed.match(SAN_PATTERN) ?? []).find((s) => !allowedSans.has(s));
  if (san !== undefined) return { reason: 'token', token: san };

  return null;
}

/**
 * ST-177. The allowlists for one coaching fact set, in the shape
 * `adviceIsValid` builds: every number the prompt prints, and the two moves it
 * names. The eval renderings come from `zai.ts` rather than being restated
 * here, so this check cannot drift from what the model was shown.
 */
export function mistakeFactTokens(facts: MistakeFacts): {
  numbers: Set<string>;
  sans: Set<string>;
} {
  const numbers = new Set<string>([String(facts.moveNumber), String(facts.cpLoss)]);
  for (const cp of [facts.evalBeforeCp, facts.evalAfterCp]) {
    if (cp !== null) numbers.add(pawnsMagnitude(cp));
  }
  for (const mate of [facts.evalBeforeMate, facts.evalAfterMate]) {
    if (mate !== null) numbers.add(mateDistance(mate));
  }
  return { numbers, sans: new Set([facts.moveSan, facts.bestMoveSan]) };
}

export function adviceIsValid(text: string, facts: ReportAdviceFacts): boolean {
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

  const allowedSans = new Set(facts.instances.flatMap((i) => [i.moveSan, i.bestMoveSan]));
  return textWithinFacts(text, allowedNumbers, allowedSans, 2);
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

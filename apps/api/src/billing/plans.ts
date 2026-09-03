/**
 * ST-074. The three plans, their prices, and their monthly caps.
 *
 * `amountMinor` is what Razorpay's order API takes: minor units, paise for
 * INR. The plan names here, in `contract/schemas.ts`, and in `db/schema.ts`'s
 * `tierEnum` are one list of three and must move together. Priced for the
 * Indian market against comparable chess-improvement apps (Aimchess,
 * Chessable, ChessDojo, all $8-15/month for their paid tier): intermediate
 * undercuts them as the accessible middle option, pro holds Kanso's existing
 * price.
 */
export type Tier = 'beginner' | 'intermediate' | 'pro';

/** Beginner needs no checkout, so only the other two have a price. */
export type PayableTier = Exclude<Tier, 'beginner'>;

export const PLAN_PRICES: Record<PayableTier, { amountMinor: number }> = {
  intermediate: { amountMinor: 79900 },
  pro: { amountMinor: 129900 },
};

export const CURRENCY = 'INR' as const;

/** Games analysed per calendar month; `null` is uncapped (pro). */
export const ANALYSIS_MONTHLY_CAP: Record<Tier, number | null> = {
  beginner: 30,
  intermediate: 150,
  pro: null,
};

/**
 * ST-111. Generated coach texts (explanation plus Socratic question, one
 * shared budget) per calendar month; `null` is uncapped (pro). Cached
 * re-reads of an already-generated text are free and never reach this cap.
 */
export const EXPLANATION_MONTHLY_CAP: Record<Tier, number | null> = {
  beginner: 50,
  intermediate: 100,
  pro: null,
};

/** A plan renews a month after it is bought. Informational for now: nothing renews automatically yet. */
export function nextRenewal(now: Date = new Date()): Date {
  const copy = new Date(now);
  copy.setUTCMonth(copy.getUTCMonth() + 1);
  return copy;
}

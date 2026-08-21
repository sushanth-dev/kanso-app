/**
 * ST-074. The three plans, their prices, and their monthly analysis caps.
 *
 * `amountCents` is what Razorpay's order API takes: minor units, cents for
 * USD. The plan names here, in `contract/schemas.ts`, and in `db/schema.ts`'s
 * `tierEnum` are one list of three and must move together. Priced against
 * comparable chess-improvement apps (Aimchess, Chessable, ChessDojo, all
 * $8-15/month for their paid tier): intermediate undercuts them as the
 * accessible middle option, pro holds Kanso's existing price.
 */
export type Tier = 'beginner' | 'intermediate' | 'pro';

/** Beginner needs no checkout, so only the other two have a price. */
export type PayableTier = Exclude<Tier, 'beginner'>;

export const PLAN_PRICES: Record<PayableTier, { amountCents: number }> = {
  intermediate: { amountCents: 900 },
  pro: { amountCents: 1500 },
};

export const CURRENCY = 'USD' as const;

/** Games analysed per calendar month; `null` is uncapped (pro). */
export const ANALYSIS_MONTHLY_CAP: Record<Tier, number | null> = {
  beginner: 30,
  intermediate: 150,
  pro: null,
};

/** A plan renews a month after it is bought. Informational for now: nothing renews automatically yet. */
export function nextRenewal(now: Date = new Date()): Date {
  const copy = new Date(now);
  copy.setUTCMonth(copy.getUTCMonth() + 1);
  return copy;
}

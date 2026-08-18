/**
 * ST-044, ADR-0039. The three plans and their prices, from ST-043.
 *
 * `amountCents` is what Razorpay's order API takes: minor units, cents for
 * USD. The plan names here, in `contract/schemas.ts`, and in `db/schema.ts`'s
 * `planEnum` are one list of three and must move together.
 */
export type Plan = 'monthly' | 'season' | 'yearly';

export const PLAN_PRICES: Record<Plan, { amountCents: number }> = {
  monthly: { amountCents: 1500 },
  season: { amountCents: 13000 },
  yearly: { amountCents: 15000 },
};

export const CURRENCY = 'USD' as const;

/** B2. The free tier analyses up to thirty games a month (`pricing.md`). */
export const FREE_ANALYSIS_MONTHLY_CAP = 30;

/**
 * The date the purchased period ends. Informational for now: nothing renews.
 * A season is the school term, September to May, so its end is the next May 31.
 */
export function periodEndFor(plan: Plan, now: Date = new Date()): Date {
  if (plan === 'monthly') return addMonths(now, 1);
  if (plan === 'yearly') return addMonths(now, 12);
  const year = now.getUTCFullYear();
  const endYear = now.getUTCMonth() >= 5 ? year + 1 : year;
  return new Date(Date.UTC(endYear, 4, 31));
}

function addMonths(date: Date, months: number): Date {
  const copy = new Date(date);
  copy.setUTCMonth(copy.getUTCMonth() + months);
  return copy;
}

/**
 * ST-169. Single display source for plan prices in the web application.
 *
 * Holds the base payable prices (matched to server PLAN_PRICES via drift test),
 * committed exchange rates with dates and sources, and locale detection logic.
 *
 * Rules:
 * 1. The charge is always in INR via Razorpay.
 * 2. Converted prices are labelled as estimates and dated.
 * 3. Never claim acceptance of international cards.
 * 4. Fallback to INR with an explanation when currency is unsupported.
 */

export interface CurrencyRate {
  code: string;
  symbol: string;
  ratePerInr: number;
  date: string;
  source: string;
}

export type SupportedCurrency = 'USD' | 'EUR' | 'GBP';

/**
 * Committed exchange rate table (ST-169).
 * Avoids third-party runtime dependencies in payment surfaces.
 */
export const EXCHANGE_RATES: Record<SupportedCurrency, CurrencyRate> = {
  USD: {
    code: 'USD',
    symbol: '$',
    ratePerInr: 0.012,
    date: '2026-09-18',
    source: 'RBI / ECB reference rate',
  },
  EUR: {
    code: 'EUR',
    symbol: '€',
    ratePerInr: 0.011,
    date: '2026-09-18',
    source: 'ECB reference rate',
  },
  GBP: {
    code: 'GBP',
    symbol: '£',
    ratePerInr: 0.0094,
    date: '2026-09-18',
    source: 'Bank of England reference rate',
  },
};

export type PayablePlanTier = 'intermediate' | 'pro';

export const DISPLAY_PLAN_PRICES: Record<
  PayablePlanTier,
  { amountMinor: number; inrString: string }
> = {
  intermediate: { amountMinor: 79900, inrString: '₹799' },
  pro: { amountMinor: 129900, inrString: '₹1,299' },
};

export interface PriceDisplayInfo {
  tier: 'beginner' | PayablePlanTier;
  isPayable: boolean;
  /** Primary display string on the card (e.g. "Free", "₹799", or "~$9.59") */
  primaryPrice: string;
  /** Always states the charged INR amount for payable plans (e.g. "Charged as ₹799 in INR") */
  chargedInrText: string | null;
  /** Present when a conversion estimate is shown */
  estimateInfo: {
    isEstimated: boolean;
    date: string;
    source: string;
    currencyCode: string;
  } | null;
  /** Present when user is in an unsupported region falling back to INR */
  unsupportedNotice: string | null;
  /** Button text suffix or amount */
  buttonPrice: string;
}

/**
 * Maps a locale string to a currency code or marks it unsupported.
 */
export function resolveLocaleCurrency(locale?: string): {
  currency: 'INR' | SupportedCurrency;
  isUnsupported: boolean;
} {
  const loc =
    locale ??
    (typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-IN');
  const tag = loc.trim().toLowerCase();

  // Explicit Indian locales
  if (
    tag.includes('-in') ||
    tag === 'in' ||
    tag.startsWith('hi') ||
    tag.startsWith('te') ||
    tag.startsWith('ta') ||
    tag.startsWith('bn') ||
    tag.startsWith('gu') ||
    tag.startsWith('kn') ||
    tag.startsWith('ml') ||
    tag.startsWith('mr') ||
    tag.startsWith('pa')
  ) {
    return { currency: 'INR', isUnsupported: false };
  }

  // US
  if (tag.includes('-us') || tag === 'en-us') {
    return { currency: 'USD', isUnsupported: false };
  }

  // UK
  if (tag.includes('-gb') || tag === 'en-gb') {
    return { currency: 'GBP', isUnsupported: false };
  }

  // Eurozone
  const eurozone = ['-de', '-fr', '-es', '-it', '-nl', '-ie', '-be', '-at', '-pt', '-fi', '-gr'];
  if (eurozone.some((r) => tag.includes(r))) {
    return { currency: 'EUR', isUnsupported: false };
  }

  // If bare language or default 'en' without region, check if it's default
  if (tag === 'en') {
    return { currency: 'INR', isUnsupported: false };
  }

  // Any other locale (e.g. ja-JP, zh-CN, pt-BR, en-AU, en-CA)
  return { currency: 'INR', isUnsupported: true };
}

/**
 * Returns formatted price information for a plan tier based on visitor locale.
 */
export function getPlanPriceDisplay(
  tier: 'beginner' | PayablePlanTier,
  locale?: string,
): PriceDisplayInfo {
  if (tier === 'beginner') {
    return {
      tier,
      isPayable: false,
      primaryPrice: 'Free',
      chargedInrText: null,
      estimateInfo: null,
      unsupportedNotice: null,
      buttonPrice: 'Free',
    };
  }

  const base = DISPLAY_PLAN_PRICES[tier];
  const { currency, isUnsupported } = resolveLocaleCurrency(locale);

  if (isUnsupported) {
    return {
      tier,
      isPayable: true,
      primaryPrice: base.inrString,
      chargedInrText: `Charged as ${base.inrString} in INR via Razorpay.`,
      estimateInfo: null,
      unsupportedNotice:
        'Shown in Indian Rupees (₹) because local estimates are not available for your currency.',
      buttonPrice: base.inrString,
    };
  }

  if (currency === 'INR') {
    return {
      tier,
      isPayable: true,
      primaryPrice: base.inrString,
      chargedInrText: null,
      estimateInfo: null,
      unsupportedNotice: null,
      buttonPrice: base.inrString,
    };
  }

  // Supported non-INR currency
  const rate = EXCHANGE_RATES[currency];
  const inrRupees = base.amountMinor / 100;
  const estimatedAmount = (inrRupees * rate.ratePerInr).toFixed(2);
  const estimatedStr = `~${rate.symbol}${estimatedAmount}`;

  return {
    tier,
    isPayable: true,
    primaryPrice: estimatedStr,
    chargedInrText: `Charged as ${base.inrString} in INR.`,
    estimateInfo: {
      isEstimated: true,
      date: rate.date,
      source: rate.source,
      currencyCode: rate.code,
    },
    unsupportedNotice: null,
    buttonPrice: base.inrString,
  };
}

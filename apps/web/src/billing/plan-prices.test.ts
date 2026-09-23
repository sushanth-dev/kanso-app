import { describe, expect, test } from 'vitest';
import { PLAN_PRICES } from '../../../api/src/billing/plans.ts';
import {
  DISPLAY_PLAN_PRICES,
  EXCHANGE_RATES,
  getPlanPriceDisplay,
  resolveLocaleCurrency,
} from './plan-prices.ts';

describe('plan-prices drift and currency resolution (ST-169)', () => {
  test('client display prices match server PLAN_PRICES exactly', () => {
    expect(DISPLAY_PLAN_PRICES.intermediate.amountMinor).toBe(PLAN_PRICES.intermediate.amountMinor);
    expect(DISPLAY_PLAN_PRICES.pro.amountMinor).toBe(PLAN_PRICES.pro.amountMinor);
    expect(DISPLAY_PLAN_PRICES.intermediate.inrString).toBe('₹799');
    expect(DISPLAY_PLAN_PRICES.pro.inrString).toBe('₹1,299');
  });

  test('resolves Indian locales to INR without conversion', () => {
    expect(resolveLocaleCurrency('en-IN')).toEqual({ currency: 'INR', isUnsupported: false });
    expect(resolveLocaleCurrency('hi-IN')).toEqual({ currency: 'INR', isUnsupported: false });
    expect(resolveLocaleCurrency('te-IN')).toEqual({ currency: 'INR', isUnsupported: false });
  });

  test('resolves supported foreign locales to USD, GBP, and EUR', () => {
    expect(resolveLocaleCurrency('en-US')).toEqual({ currency: 'USD', isUnsupported: false });
    expect(resolveLocaleCurrency('en-GB')).toEqual({ currency: 'GBP', isUnsupported: false });
    expect(resolveLocaleCurrency('de-DE')).toEqual({ currency: 'EUR', isUnsupported: false });
    expect(resolveLocaleCurrency('fr-FR')).toEqual({ currency: 'EUR', isUnsupported: false });
  });

  test('resolves unsupported locales to INR with unsupported flag', () => {
    expect(resolveLocaleCurrency('ja-JP')).toEqual({ currency: 'INR', isUnsupported: true });
    expect(resolveLocaleCurrency('zh-CN')).toEqual({ currency: 'INR', isUnsupported: true });
  });

  test('formats INR visitor prices with no conversion or estimate marker', () => {
    const intermediate = getPlanPriceDisplay('intermediate', 'en-IN');
    expect(intermediate.primaryPrice).toBe('₹799');
    expect(intermediate.estimateInfo).toBeNull();
    expect(intermediate.unsupportedNotice).toBeNull();

    const pro = getPlanPriceDisplay('pro', 'en-IN');
    expect(pro.primaryPrice).toBe('₹1,299');
    expect(pro.estimateInfo).toBeNull();
    expect(pro.unsupportedNotice).toBeNull();
  });

  test('formats supported foreign currency prices as dated estimates stating rupee charge', () => {
    const usd = getPlanPriceDisplay('intermediate', 'en-US');
    expect(usd.primaryPrice).toBe('~$9.59');
    expect(usd.estimateInfo).toEqual({
      isEstimated: true,
      date: '2026-09-18',
      source: EXCHANGE_RATES.USD.source,
      currencyCode: 'USD',
    });
    expect(usd.chargedInrText).toBe('Charged as ₹799 in INR.');

    const eur = getPlanPriceDisplay('pro', 'de-DE');
    expect(eur.primaryPrice).toBe('~€14.29');
    expect(eur.estimateInfo?.currencyCode).toBe('EUR');
    expect(eur.chargedInrText).toBe('Charged as ₹1,299 in INR.');
  });

  test('formats unsupported currency visitor with rupee price and explanation clause', () => {
    const jp = getPlanPriceDisplay('intermediate', 'ja-JP');
    expect(jp.primaryPrice).toBe('₹799');
    expect(jp.estimateInfo).toBeNull();
    expect(jp.unsupportedNotice).toContain(
      'Shown in Indian Rupees (₹) because local estimates are not available for your currency.',
    );
    expect(jp.chargedInrText).toBe('Charged as ₹799 in INR via Razorpay.');
  });

  test('beginner plan is always Free', () => {
    const free = getPlanPriceDisplay('beginner', 'en-US');
    expect(free.primaryPrice).toBe('Free');
    expect(free.isPayable).toBe(false);
  });
});

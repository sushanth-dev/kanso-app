import createClient from 'openapi-fetch';
import type { components, paths } from '../generated/api.ts';
import { apiBaseUrl } from './base-url.ts';
import { failure } from './account-api.ts';

export type PayableTier = components['schemas']['PayableTier'];
export type CheckoutResponse = components['schemas']['CheckoutResponse'];

export interface CheckoutApi {
  checkout(tier: PayableTier): Promise<CheckoutResponse>;
}

export function createCheckoutApi(
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): CheckoutApi {
  const client = createClient<paths>({
    baseUrl: apiBaseUrl,
    fetch: fetcher,
    credentials: 'include',
  });
  return {
    async checkout(tier) {
      const result = await client.POST('/payments/checkout', { body: { tier } });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
  };
}

export const checkoutApi = createCheckoutApi();

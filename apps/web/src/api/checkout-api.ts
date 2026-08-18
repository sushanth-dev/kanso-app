import createClient from 'openapi-fetch';
import type { components, paths } from '../generated/api.ts';
import { apiBaseUrl } from './base-url.ts';
import { failure } from './account-api.ts';

export type Plan = components['schemas']['Plan'];
export type CheckoutResponse = components['schemas']['CheckoutResponse'];

export interface CheckoutApi {
  checkout(plan: Plan): Promise<CheckoutResponse>;
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
    async checkout(plan) {
      const result = await client.POST('/payments/checkout', { body: { plan } });
      if (result.data !== undefined) return result.data;
      throw failure(result.response.status, result.error);
    },
  };
}

export const checkoutApi = createCheckoutApi();

/**
 * Server-side exception capture (ADR-0038, second amendment of 2026-09-04).
 *
 * The browser suite catches client errors through posthog-js; a server error
 * until now died in the structured logs alone. posthog-node sends unhandled
 * API exceptions to the same Error tracking project, so a production 500
 * carries its replay, its stack, and its log line in one place.
 *
 * This is deliberately exceptions-only. The four product events stay
 * client-side and property-only under the contract in the web `analytics.ts`;
 * the server is an error path, never a second capture path that could
 * double-count them. Nothing here calls identify: the exceptions carry a
 * fixed anonymous distinct id that merely groups them under one profile.
 *
 * The key is the same public project token the web build ships, so a real
 * value is not a secret. Empty or unset, every call is a no-op; vitest runs
 * never send even with a key present, because `test:integration` loads
 * `.env`/`.env.local` into its workers.
 */
import { PostHog } from 'posthog-node';

export interface PostHogConfig {
  apiKey: string;
}

export function posthogConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): PostHogConfig | null {
  // An empty key is an unset key: the deploy wiring sends one (infra/api.ts),
  // the same empty-vs-unset guard the Z.AI and Resend seams needed.
  const apiKey = env.POSTHOG_KEY;
  if (!apiKey) return null;
  return { apiKey };
}

// One client per key per execution environment; a Lambda serves every request
// in the environment with the same instance, like the database handle.
let cachedKey: string | null = null;
let client: PostHog | null = null;

function analyticsClient(): PostHog | null {
  const config = posthogConfigFromEnv();
  if (!config) return null;
  if (process.env.VITEST) return null;
  if (client && cachedKey === config.apiKey) return client;
  // flushAt 1 with the periodic interval parked at a minute: the error path
  // awaits flush() explicitly, because a Lambda freezes the execution
  // environment the moment the response returns and a background timer would
  // never fire.
  client = new PostHog(config.apiKey, { flushAt: 1, flushInterval: 60_000, requestTimeout: 3_000 });
  cachedKey = config.apiKey;
  return client;
}

/** The server's anonymous distinct id: one profile grouping every API exception. */
const SERVER_DISTINCT_ID = 'kanso-api';

/** Send one unhandled server exception to PostHog error tracking. */
export async function captureApiException(
  error: unknown,
  context: Record<string, string> = {},
): Promise<void> {
  const posthog = analyticsClient();
  if (!posthog) return;
  try {
    posthog.captureException(error, SERVER_DISTINCT_ID, { ...context });
    await posthog.flush();
  } catch {
    // Error capture must never turn a 500 into a second failure; the
    // structured log above the seam already carries the same event.
  }
}

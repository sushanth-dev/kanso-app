/**
 * Product analytics and the PostHog suite (ADR-0038, amended 2026-09-03;
 * ST-112).
 *
 * The full PostHog suite is on: web analytics (autocapture and pageviews, the
 * SDK defaults), session replay, surveys, the support widget, feature flags,
 * and error tracking (the one explicit line below). The amendment replaced
 * ST-045's minimal surface: autocapture and replay read the DOM and the URL,
 * so game content and whatever is on screen reaches PostHog Cloud. Sushanth
 * accepted that trade on 3 September 2026 for PostHog's robustness, retiring
 * the in-app feedback and what's-new pages the same day.
 *
 * The explicit event contract is unchanged and still property-only. Reuse
 * these events, do not invent new ones:
 *
 * | Event | Properties | Objective |
 * | --- | --- | --- |
 * | `game_imported` | `{ source, gamesFound, gamesImported }` | O1 first step, O2 second step |
 * | `report_viewed` | `{ stream }` | O1 second step |
 * | `focus_set` | `{ source, catalogueKey? }` | O2 first step |
 * | `converted_to_paid` | `{ tier }` | O3 |
 *
 * Nothing calls identify: the SDK's anonymous distinct_id is the only identity
 * PostHog holds for a player.
 */
import posthog from 'posthog-js';

const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;

if (key) {
  posthog.init(key, {
    // Web analytics, session replay, surveys, the support widget and feature
    // flags ride the SDK defaults. Error tracking is the one opt-in.
    capture_exceptions: true,
  });
}

/**
 * The only property keys an explicit event may carry (ADR-0038). It bounds the
 * four events above, not the suite: autocapture and replay are the amended
 * decision's acceptance and do not pass through here. An unexpected property
 * is dropped at the one choke point every explicit event passes through,
 * rather than trusting each caller.
 */
const ALLOWED_PROPERTIES: Record<string, true> = {
  source: true,
  gamesFound: true,
  gamesImported: true,
  stream: true,
  catalogueKey: true,
  tier: true,
};

export function safeProperties(
  properties: Record<string, string | number>,
): Record<string, string | number> {
  const safe: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(properties)) {
    if (ALLOWED_PROPERTIES[name]) safe[name] = value;
  }
  return safe;
}

/** Fire a property-only product event. A no-op until VITE_POSTHOG_KEY is set. */
export function track(event: string, properties: Record<string, string | number> = {}): void {
  if (!key) return;
  posthog.capture(event, safeProperties(properties));
}

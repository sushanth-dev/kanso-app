/**
 * Product analytics (ADR-0038, ST-045).
 *
 * PostHog is client-side only, public key only, and autocapture is off. That
 * last point is load-bearing: autocapture reads the DOM, and a report page
 * shows a child's name and game content in the DOM; that must never reach a
 * third party. Only the explicit, property-only events below are sent.
 *
 * Event contract (reuse these, do not invent new ones):
 *
 * | Event | Properties | Objective |
 * | --- | --- | --- |
 * | `game_imported` | `{ source, gamesFound, gamesImported }` | O1 first step, O2 second step |
 * | `report_viewed` | `{ stream }` | O1 second step |
 * | `focus_set` | `{ source, catalogueKey? }` | O2 first step |
 * | `converted_to_paid` | `{ tier }` | O3 |
 *
 * No event carries a game position, an analysis, a child's name or email, or a
 * player id. PostHog's own anonymous distinct_id ties events to the account
 * holder, so nothing calls identify.
 */
import posthog from 'posthog-js';

const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;

if (key) {
  posthog.init(key, {
    // Load-bearing (ADR-0038): neither autocapture nor pageview capture may
    // read the DOM or the URL, both of which can carry a child's name or a
    // player id on this product.
    autocapture: false,
    capture_pageview: false,
  });
}

/**
 * The only property keys any event may carry (ADR-0038). A game position, an
 * analysis, a child's name or email, or a player id is not in this set, so
 * `safeProperties` drops it at the one choke point every event passes through,
 * rather than trusting each caller. The COPPA line is the one place this story
 * is strict rather than minimal.
 */
const ALLOWED_PROPERTIES = new Set([
  'source',
  'gamesFound',
  'gamesImported',
  'stream',
  'catalogueKey',
  'tier',
]);

export function safeProperties(
  properties: Record<string, string | number>,
): Record<string, string | number> {
  const safe: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(properties)) {
    if (ALLOWED_PROPERTIES.has(name)) safe[name] = value;
  }
  return safe;
}

/** Fire a property-only product event. A no-op until VITE_POSTHOG_KEY is set. */
export function track(event: string, properties: Record<string, string | number> = {}): void {
  if (!key) return;
  posthog.capture(event, safeProperties(properties));
}

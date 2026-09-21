/**
 * Product analytics and the PostHog suite (ADR-0038, amended 2026-09-03 by
 * ST-112, narrowed 2026-09-14 by ST-176).
 *
 * For an account the gate below allows, the full PostHog suite is on: web
 * analytics (autocapture and pageviews, the SDK defaults), session replay,
 * surveys, the support widget, feature flags, and error tracking (the one
 * explicit line). The ST-112 amendment replaced ST-045's minimal surface:
 * autocapture and replay read the DOM and the URL, so game content and whatever
 * is on screen reaches PostHog Cloud. Sushanth accepted that trade on
 * 3 September 2026 for PostHog's robustness, retiring the in-app feedback and
 * what's-new pages the same day.
 *
 * ST-176 narrows who that trade applies to. The suite starts with its automatic
 * capture off, and `enableAnalyticsSuite` turns it on only for an account whose
 * age the server has positively established: a date of birth outside the
 * minor-consent gate, or a recorded guardian consent. Silence is not a statement
 * of age, so an account that never gave a date of birth keeps replay, autocapture
 * and page views off, and so does a visitor with no account at all. Gated, what
 * leaves the browser is the four events below and the feature-flag read.
 *
 * Initialisation stays at import rather than moving behind the gate: feature
 * flags and the announcement bar are configuration we read, not data we collect,
 * and they have to work for a visitor we know nothing about. `set_config` is the
 * SDK's supported way to turn capture on afterwards, and it reaches every
 * subsystem (replay, autocapture, page views, errors, surveys). One cost, named
 * rather than hidden: the SDK sends the entry page view at initialisation, so an
 * allowed account's session loses the page view for the URL it landed on, and
 * every later navigation is captured.
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
import type { PostHogConfig } from 'posthog-js';

const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;

/**
 * ST-176. What the suite may do before an account has established that it is
 * outside the minor-consent gate. Feature flags are deliberately not switched
 * off: a flag is configuration, and the announcement bar reads one.
 */
const GATED_CAPTURE = {
  autocapture: false,
  capture_pageview: false,
  capture_exceptions: false,
  disable_session_recording: true,
  disable_surveys: true,
} as const satisfies Partial<PostHogConfig>;

/**
 * The ADR-0038 suite, for an account the gate allows. `capture_pageview` is
 * `'history_change'` because that is the SDK default this restores: plain `true`
 * sends the entry page view but leaves history monitoring stopped, which would
 * lose every later navigation.
 */
const ESTABLISHED_CAPTURE = {
  autocapture: true,
  capture_pageview: 'history_change',
  capture_exceptions: true,
  disable_session_recording: false,
  disable_surveys: false,
} as const satisfies Partial<PostHogConfig>;

if (key) {
  posthog.init(key, GATED_CAPTURE);
}

let suiteStarted = false;

/**
 * ST-176. Turn the suite's automatic capture on for an account the server's gate
 * allows. Called once per app load, after `/me` resolves and before the account
 * route renders. A second call is a no-op, and a page that never calls it leaves
 * the capture off, which is the direction this gate has to fail in.
 */
export function enableAnalyticsSuite(): void {
  if (!key || suiteStarted) return;
  suiteStarted = true;
  posthog.set_config(ESTABLISHED_CAPTURE);
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

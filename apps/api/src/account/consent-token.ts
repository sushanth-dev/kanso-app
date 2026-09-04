/**
 * The consent confirm token, signed so the confirm route can trust it without
 * a session (N7). The sign-and-verify mechanism lives in `signed-token.ts`,
 * shared with the nudge unsubscribe token; this module owns only the consent
 * payload: which `guardian_consent` request to confirm, and when the token
 * stops working.
 *
 * Single-use falls out of the data rather than a stored flag: the confirm route
 * writes `consent_granted_at` only while it is still null, so a second use of
 * the same token finds the link already consented and answers 204 without
 * writing.
 */
import { parseToken, signToken } from '../signed-token.ts';

/** Consent links live for three days, long enough to survive a weekend. */
export const CONSENT_TOKEN_TTL_SECONDS = 72 * 60 * 60;

/**
 * Build a token for `linkId`. `ttlSeconds` is exposed for the expired-token
 * test, which signs a token that is already past, and defaults to the normal
 * window.
 */
export function signConsentToken(
  linkId: string,
  ttlSeconds: number = CONSENT_TOKEN_TTL_SECONDS,
): string {
  return signToken({
    linkId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
}

export type ConsentTokenResult =
  { ok: true; linkId: string } | { ok: false; reason: 'malformed' | 'tampered' | 'expired' };

export function verifyConsentToken(token: string): ConsentTokenResult {
  const parsed = parseToken(token);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason };
  }
  if (typeof parsed.payload.linkId !== 'string') {
    return { ok: false, reason: 'malformed' };
  }
  return { ok: true, linkId: parsed.payload.linkId };
}

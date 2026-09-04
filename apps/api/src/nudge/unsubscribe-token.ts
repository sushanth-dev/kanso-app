/**
 * The nudge unsubscribe token, signed so the unsubscribe route can trust the
 * click without a session (ST-126). The sign-and-verify mechanism is the
 * shared `signed-token.ts`; this module owns only the payload: which user
 * clicked, and when the link stops working.
 *
 * Every weekly email carries a fresh token, so expiry only means the next
 * email brings a new link. Thirty days covers a missed week with room to
 * spare.
 */
import { parseToken, signToken } from '../signed-token.ts';

export const NUDGE_UNSUBSCRIBE_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * `ttlSeconds` is exposed for the expired-token test, which signs a token that
 * is already past, and defaults to the normal window.
 */
export function signUnsubscribeToken(
  userId: string,
  ttlSeconds: number = NUDGE_UNSUBSCRIBE_TTL_SECONDS,
): string {
  return signToken({
    userId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
}

export type UnsubscribeTokenResult =
  { ok: true; userId: string } | { ok: false; reason: 'malformed' | 'tampered' | 'expired' };

export function verifyUnsubscribeToken(token: string): UnsubscribeTokenResult {
  const parsed = parseToken(token);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason };
  }
  if (typeof parsed.payload.userId !== 'string') {
    return { ok: false, reason: 'malformed' };
  }
  return { ok: true, userId: parsed.payload.userId };
}

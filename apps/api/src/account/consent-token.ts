/**
 * The consent confirm token, signed so the confirm route can trust it without
 * a session (N7).
 *
 * The payload is `{ linkId, exp }`: which `guardian_consent` request to confirm, and when
 * the token stops working. The signature is HMAC-SHA256 keyed by
 * `BETTER_AUTH_SECRET`, the same secret better-auth signs sessions with, so
 * there is no second secret to manage. Tampering with either half fails
 * verification; an expired token is rejected before the link is ever read.
 *
 * Single-use falls out of the data rather than a stored flag: the confirm route
 * writes `consent_granted_at` only while it is still null, so a second use of
 * the same token finds the link already consented and answers 204 without
 * writing.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

interface ConsentTokenPayload {
  linkId: string;
  /** Unix seconds. */
  exp: number;
}

/** Consent links live for three days, long enough to survive a weekend. */
export const CONSENT_TOKEN_TTL_SECONDS = 72 * 60 * 60;

function sign(payload: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET is not set. See .env.example.');
  }
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Build a token for `linkId`. `ttlSeconds` is exposed for the expired-token
 * test, which signs a token that is already past, and defaults to the normal
 * window.
 */
export function signConsentToken(
  linkId: string,
  ttlSeconds: number = CONSENT_TOKEN_TTL_SECONDS,
): string {
  const payload: ConsentTokenPayload = {
    linkId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

export type ConsentTokenResult =
  { ok: true; linkId: string } | { ok: false; reason: 'malformed' | 'tampered' | 'expired' };

export function verifyConsentToken(token: string): ConsentTokenResult {
  const dot = token.lastIndexOf('.');
  if (dot <= 0 || dot === token.length - 1) {
    return { ok: false, reason: 'malformed' };
  }

  const body = token.slice(0, dot);
  const presented = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(body));
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return { ok: false, reason: 'tampered' };
  }

  let payload: ConsentTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ConsentTokenPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof payload.linkId !== 'string' || typeof payload.exp !== 'number') {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, linkId: payload.linkId };
}

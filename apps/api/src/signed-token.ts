/**
 * The one HMAC token mechanism, shared by every route that must trust a link
 * without a session. The payload is any JSON object; the signature is
 * HMAC-SHA256 keyed by `BETTER_AUTH_SECRET`, the same secret better-auth signs
 * sessions with, so there is no second secret to manage. Tampering with
 * either half fails verification, and an `exp` in the past is rejected here
 * rather than by every caller.
 *
 * Callers still validate their own payload fields; this module only vouches
 * for integrity and freshness. `consent-token.ts` and
 * `nudge/unsubscribe-token.ts` are its consumers.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

function sign(body: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET is not set. See .env.example.');
  }
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function signToken(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

export type ParsedToken =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: 'malformed' | 'tampered' | 'expired' };

export function parseToken(token: string): ParsedToken {
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

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, reason: 'malformed' };
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.exp !== 'number') {
    return { ok: false, reason: 'malformed' };
  }
  if (record.exp <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, payload: record };
}

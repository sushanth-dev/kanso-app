/**
 * The unsubscribe token is the only thing standing between a click and the
 * flag, so its failure modes are proven here: a round trip, an expired token,
 * a tampered one, and a malformed string all answer exactly what the route
 * branches on.
 */
import { strict as assert } from 'node:assert';
import { beforeAll, describe, expect, test } from 'vitest';
import { signConsentToken } from '../account/consent-token.ts';
import {
  NUDGE_UNSUBSCRIBE_TTL_SECONDS,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from './unsubscribe-token.ts';

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = 'test-signing-secret';
});

describe('signUnsubscribeToken', () => {
  test('round-trips through the thirty-day window', () => {
    expect(NUDGE_UNSUBSCRIBE_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
    expect(verifyUnsubscribeToken(signUnsubscribeToken('user-1'))).toEqual({
      ok: true,
      userId: 'user-1',
    });
  });
});

describe('verifyUnsubscribeToken', () => {
  test('rejects a token whose window has passed', () => {
    const token = signUnsubscribeToken('user-1', -1);
    expect(verifyUnsubscribeToken(token)).toEqual({ ok: false, reason: 'expired' });
  });

  test('rejects a tampered signature', () => {
    const token = signUnsubscribeToken('user-1');
    const [body, sig] = token.split('.');
    assert(body !== undefined && sig !== undefined);
    // The signature varies per run (the payload carries a wall-clock exp), so
    // the flip must guarantee a change: flipping to 'A' is a no-op on the
    // roughly one run in sixty-four whose signature already ends in 'A'.
    const flipped = sig.endsWith('A') ? 'B' : 'A';
    expect(verifyUnsubscribeToken(`${body}.${sig.slice(0, -1)}${flipped}`)).toEqual({
      ok: false,
      reason: 'tampered',
    });
  });

  test('rejects a tampered payload', () => {
    const token = signUnsubscribeToken('user-1');
    const [, sig] = token.split('.');
    assert(sig !== undefined);
    // A different payload under the same signature fails the HMAC before the
    // payload is ever parsed.
    const other = Buffer.from(JSON.stringify({ userId: 'user-2', exp: 9e12 })).toString(
      'base64url',
    );
    expect(verifyUnsubscribeToken(`${other}.${sig}`)).toEqual({ ok: false, reason: 'tampered' });
  });

  test('rejects a malformed string', () => {
    expect(verifyUnsubscribeToken('not-a-token')).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyUnsubscribeToken('.')).toEqual({ ok: false, reason: 'malformed' });
  });

  test('rejects a well-signed payload without a userId', () => {
    // Signed with the shared mechanism but carrying the consent payload: the
    // signature verifies, the field check rejects.
    const token = signConsentToken('link-1');
    expect(verifyUnsubscribeToken(token)).toEqual({ ok: false, reason: 'malformed' });
  });
});

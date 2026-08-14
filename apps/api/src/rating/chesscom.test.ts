/**
 * ST-018. The Chess.com provider, with the outbound call stubbed.
 *
 * The charset check and the response parse are the "boundary validation" the
 * story names, and they sit behind the seam the integration test stubs, so
 * they are covered here at the cheapest level.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchChesscomRating, isPlausibleChesscomUsername } from './chesscom.ts';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  fetchMock.mockReset();
});

describe('isPlausibleChesscomUsername', () => {
  test('accepts letters, digits, underscore, and hyphen', () => {
    expect(isPlausibleChesscomUsername('online_kid-12')).toBe(true);
  });

  test('rejects a username with a slash, a space, or a query character', () => {
    expect(isPlausibleChesscomUsername('on/line')).toBe(false);
    expect(isPlausibleChesscomUsername('on line')).toBe(false);
    expect(isPlausibleChesscomUsername('on?line')).toBe(false);
  });

  test('rejects a username outside the length bounds', () => {
    expect(isPlausibleChesscomUsername('ab')).toBe(false);
    expect(isPlausibleChesscomUsername('a'.repeat(26))).toBe(false);
  });
});

describe('fetchChesscomRating', () => {
  test('returns the rapid rating from a well-formed body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ chess_rapid: { last: { rating: 1900 } } }));
    await expect(fetchChesscomRating('onlinekid')).resolves.toBe(1900);
  });

  test('returns null and never calls fetch for an implausible username', async () => {
    await expect(fetchChesscomRating('on/line')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns null for a non-200', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 404));
    await expect(fetchChesscomRating('onlinekid')).resolves.toBeNull();
  });

  test('returns null for a malformed body with no rating', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await expect(fetchChesscomRating('onlinekid')).resolves.toBeNull();
  });

  test('returns null for an out-of-range rating', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ chess_rapid: { last: { rating: 99999 } } }));
    await expect(fetchChesscomRating('onlinekid')).resolves.toBeNull();
  });

  test('returns null when the network fails', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    await expect(fetchChesscomRating('onlinekid')).resolves.toBeNull();
  });
});

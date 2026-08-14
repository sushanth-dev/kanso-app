/**
 * ST-018. The Lichess provider, with the outbound call stubbed.
 *
 * The charset check and the response parse are the "boundary validation" the
 * story names, and they sit behind the seam the integration test stubs, so
 * they are covered here at the cheapest level.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchLichessRating, isPlausibleLichessUsername } from './lichess.ts';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  fetchMock.mockReset();
});

describe('isPlausibleLichessUsername', () => {
  test('accepts letters, digits, underscore, and hyphen', () => {
    expect(isPlausibleLichessUsername('Online_Kid-12')).toBe(true);
  });

  test('rejects a username with a slash, a space, or a query character', () => {
    expect(isPlausibleLichessUsername('on/line')).toBe(false);
    expect(isPlausibleLichessUsername('on line')).toBe(false);
    expect(isPlausibleLichessUsername('on?line')).toBe(false);
  });

  test('rejects a username outside the length bounds', () => {
    expect(isPlausibleLichessUsername('a')).toBe(false);
    expect(isPlausibleLichessUsername('a'.repeat(21))).toBe(false);
  });
});

describe('fetchLichessRating', () => {
  test('returns the rapid rating from a well-formed body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ perfs: { rapid: { rating: 1850 } } }));
    await expect(fetchLichessRating('onlinekid')).resolves.toBe(1850);
  });

  test('returns null and never calls fetch for an implausible username', async () => {
    await expect(fetchLichessRating('on/line')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns null for a non-200', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 404));
    await expect(fetchLichessRating('onlinekid')).resolves.toBeNull();
  });

  test('returns null for a malformed body with no rating', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await expect(fetchLichessRating('onlinekid')).resolves.toBeNull();
  });

  test('returns null for an out-of-range rating', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ perfs: { rapid: { rating: 99999 } } }));
    await expect(fetchLichessRating('onlinekid')).resolves.toBeNull();
  });

  test('returns null when the network fails', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    await expect(fetchLichessRating('onlinekid')).resolves.toBeNull();
  });
});

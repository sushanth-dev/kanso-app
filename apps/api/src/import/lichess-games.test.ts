/**
 * ST-023. The Lichess game fetch, with the outbound call stubbed.
 *
 * The charset check, the page split, and the paging cursor are the "boundary
 * validation" and "paged" the story names, covered here at the cheapest level
 * behind the seam the integration test stubs.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchLichessGames } from './lichess-games.ts';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

afterEach(() => {
  fetchMock.mockReset();
});

describe('fetchLichessGames', () => {
  test('returns username_not_found without calling fetch for an implausible username', async () => {
    await expect(fetchLichessGames('on/line', new Date(0), 1000)).resolves.toEqual({
      ok: false,
      code: 'username_not_found',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns username_not_found for a 404', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not found', { status: 404 }));
    await expect(fetchLichessGames('onlinekid', new Date(0), 1000)).resolves.toEqual({
      ok: false,
      code: 'username_not_found',
    });
  });

  test('returns upstream_error for a non-200', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    await expect(fetchLichessGames('onlinekid', new Date(0), 1000)).resolves.toEqual({
      ok: false,
      code: 'upstream_error',
    });
  });

  test('returns upstream_error when the network fails', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    await expect(fetchLichessGames('onlinekid', new Date(0), 1000)).resolves.toEqual({
      ok: false,
      code: 'upstream_error',
    });
  });

  test('splits a PGN page into games with ids and clock data', async () => {
    fetchMock.mockResolvedValueOnce(new Response(fixture('lichess-games.pgn'), { status: 200 }));

    const outcome = await fetchLichessGames('onlinekid', new Date(0), 1000);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.games).toHaveLength(3);
    expect(outcome.games[0]!.externalId).toBe('kAdOQKeh');
    expect(outcome.games[0]!.pgn).toContain('%clk');
    expect(outcome.games.every((g) => g.externalId !== null)).toBe(true);
  });

  test('pages a full page into the next window', async () => {
    const fullPage = Array.from(
      { length: 500 },
      () =>
        '[Event "Test"]\n[Site "https://lichess.org/x"]\n[UTCDate "2000.01.01"]\n[UTCTime "00:00:00"]\n\n1. e4 e5',
    ).join('\n\n');
    fetchMock.mockResolvedValueOnce(new Response(fullPage, { status: 200 })).mockResolvedValueOnce(
      new Response('[Event "Test"]\n[Site "https://lichess.org/older"]\n\n1. d4 d5', {
        status: 200,
      }),
    );

    const outcome = await fetchLichessGames('onlinekid', new Date(0), 1000);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.games).toHaveLength(501);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The second request's window starts at the oldest first-page game.
    expect(fetchMock.mock.calls[1]![0]).toContain(`until=${Date.UTC(2000, 0, 1)}`);
  });

  test('bounds the fetch to maxGames, newest first', async () => {
    const page = Array.from(
      { length: 30 },
      (_, i) =>
        `[Event "Test"]\n[Site "https://lichess.org/g${i}"]\n[UTCDate "2026.08.01"]\n[UTCTime "10:00:00"]\n\n1. e4 e5`,
    ).join('\n\n');
    fetchMock.mockResolvedValueOnce(new Response(page, { status: 200 }));

    const outcome = await fetchLichessGames('onlinekid', new Date(0), 20);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.games).toHaveLength(20);
    expect(outcome.games[0]!.externalId).toBe('g0');
    expect(outcome.games[19]!.externalId).toBe('g19');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

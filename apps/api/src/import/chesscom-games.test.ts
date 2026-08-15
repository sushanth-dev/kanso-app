/**
 * ST-023. The Chess.com game fetch, with the outbound call stubbed.
 *
 * The charset check and the archive walk are the "boundary validation" and
 * "paged" the story names, and they sit behind the seam the integration test
 * stubs, so they are covered here at the cheapest level.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchChesscomGames } from './chesscom-games.ts';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  fetchMock.mockReset();
});

describe('fetchChesscomGames', () => {
  test('returns username_not_found without calling fetch for an implausible username', async () => {
    await expect(fetchChesscomGames('on/line', new Date(0))).resolves.toEqual({
      ok: false,
      code: 'username_not_found',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns username_not_found for a 404', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 404));
    await expect(fetchChesscomGames('onlinekid', new Date(0))).resolves.toEqual({
      ok: false,
      code: 'username_not_found',
    });
  });

  test('returns upstream_error for a non-200 archives response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));
    await expect(fetchChesscomGames('onlinekid', new Date(0))).resolves.toEqual({
      ok: false,
      code: 'upstream_error',
    });
  });

  test('returns upstream_error for a malformed archives body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ nope: true }));
    await expect(fetchChesscomGames('onlinekid', new Date(0))).resolves.toEqual({
      ok: false,
      code: 'upstream_error',
    });
  });

  test('returns upstream_error when the network fails', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    await expect(fetchChesscomGames('onlinekid', new Date(0))).resolves.toEqual({
      ok: false,
      code: 'upstream_error',
    });
  });

  test('walks the archive list, splits games, and extracts the id from the url', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ archives: ['https://api.chess.com/pub/player/onlinekid/games/2026/08'] }),
      )
      .mockResolvedValueOnce(jsonResponse(JSON.parse(fixture('chesscom-games.json'))));

    const outcome = await fetchChesscomGames('onlinekid', new Date(0));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.games).toHaveLength(3);
    expect(outcome.games[0]!.externalId).toBe('172385979790');
    expect(outcome.games[0]!.pgn).toContain('%clk');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('skips archives older than since', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ archives: ['https://api.chess.com/pub/player/onlinekid/games/2026/08'] }),
    );

    const outcome = await fetchChesscomGames('onlinekid', new Date('2026-09-01'));
    expect(outcome).toEqual({ ok: true, games: [] });
    // The archives list is fetched; no month archive is older than `since` is not.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

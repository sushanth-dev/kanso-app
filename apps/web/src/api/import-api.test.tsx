import { describe, expect, test } from 'vitest';
import { ApiRequestError } from './account-api.ts';
import {
  createImportApi,
  isPlausibleChesscomUsername,
  isPlausibleLichessUsername,
} from './import-api.ts';

const importJob = {
  id: 'job-1',
  source: 'chesscom' as const,
  status: 'queued' as const,
  createdAt: '2026-09-01T00:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('import username plausibility', () => {
  test.each([
    ['abc', true],
    ['a'.repeat(25), true],
    ['ab', false],
    ['a'.repeat(26), false],
    ['has space', false],
    ['Player_1-x', true],
    ['', false],
  ])('accepts or rejects the chess.com username %j', (username, expected) => {
    expect(isPlausibleChesscomUsername(username)).toBe(expected);
  });

  test.each([
    ['ab', true],
    ['a'.repeat(20), true],
    ['a', false],
    ['a'.repeat(21), false],
    ['has.dot', false],
  ])('accepts or rejects the lichess username %j', (username, expected) => {
    expect(isPlausibleLichessUsername(username)).toBe(expected);
  });
});

describe('import API transport', () => {
  test('starts a chess.com import with the online stream added', async () => {
    let lastRequest: Request | undefined;
    const api = createImportApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse(importJob));
    });

    expect(await api.startImport({ source: 'chesscom', username: 'Mina' })).toEqual(importJob);
    expect(new URL(lastRequest?.url ?? 'about:blank').pathname).toBe('/imports');
    expect(lastRequest?.method).toBe('POST');
    expect(lastRequest?.credentials).toBe('include');
    expect(await lastRequest?.json()).toEqual({
      source: 'chesscom',
      username: 'Mina',
      stream: 'online',
    });
  });

  test('starts a lichess import with the online stream added', async () => {
    let lastRequest: Request | undefined;
    const api = createImportApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse(importJob));
    });

    await api.startImport({ source: 'lichess', username: 'mina' });
    expect(await lastRequest?.json()).toEqual({
      source: 'lichess',
      username: 'mina',
      stream: 'online',
    });
  });

  test('starts a PGN upload preserving the requested stream', async () => {
    let lastRequest: Request | undefined;
    const api = createImportApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse(importJob));
    });

    await api.startImport({ source: 'pgn_upload', pgn: '1. e4 e5', stream: 'tournament' });
    expect(await lastRequest?.json()).toEqual({
      source: 'pgn_upload',
      pgn: '1. e4 e5',
      stream: 'tournament',
    });
  });

  test('starts a USCF import as a tournament stream', async () => {
    let lastRequest: Request | undefined;
    const api = createImportApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse(importJob));
    });

    await api.startImport({ source: 'uscf', tournamentName: 'City Open', playerName: 'Mina' });
    expect(await lastRequest?.json()).toEqual({
      source: 'uscf',
      tournamentName: 'City Open',
      playerName: 'Mina',
      stream: 'tournament',
    });
  });

  test('parses validation issues from a rejected import', async () => {
    const failedApi = createImportApi(() =>
      Promise.resolve(
        jsonResponse(
          {
            code: 'validation_failed',
            message: 'Bad import request.',
            issues: [{ path: 'username', message: 'not found on chess.com' }],
          },
          422,
        ),
      ),
    );

    const startImport = failedApi.startImport({ source: 'chesscom', username: 'nobody' });
    await expect(startImport).rejects.toBeInstanceOf(ApiRequestError);
    await expect(startImport).rejects.toMatchObject({
      status: 422,
      code: 'validation_failed',
      issues: [{ path: 'username', message: 'not found on chess.com' }],
      message: 'Bad import request.',
    });
  });
});

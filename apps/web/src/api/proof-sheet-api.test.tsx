import { describe, expect, test } from 'vitest';
import {
  createProofSheetApi,
  createSharedProofSheetApi,
  type ProofSheet,
  type SharedProofSheet,
} from './proof-sheet-api.ts';

const playerId = '00000000-0000-4000-8000-000000000001';
const proofSheetId = '11111111-1111-4111-8111-111111111111';

const sheetFixture: ProofSheet = {
  id: proofSheetId,
  token: 't'.repeat(43),
  url: `http://localhost:3000/shared/proof-sheets/${'t'.repeat(43)}`,
  createdAt: '2026-08-17T00:00:00.000Z',
  revokedAt: null,
  expiresAt: null,
};

const sharedFixture: SharedProofSheet = {
  playerDisplayName: 'Mina',
  focusTitle: 'Converting won positions',
  coachInstruction: null,
  stream: 'tournament',
  unit: 'share converted',
  beforeValue: 0.42,
  afterValue: 0.55,
  trend: 'improving',
  gamesBefore: 10,
  gamesAfter: 8,
  periodStart: '2026-01-01T00:00:00.000Z',
  periodEnd: '2026-06-01T00:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('proof sheet API transport', () => {
  test('lists with credentials and returns the live sheets', async () => {
    let lastRequest: Request | undefined;
    const api = createProofSheetApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse([sheetFixture]));
    });

    expect(await api.listProofSheets(playerId)).toEqual([sheetFixture]);
    expect(lastRequest?.method).toBe('GET');
    expect(lastRequest?.credentials).toBe('include');
    expect(lastRequest?.url).toMatch(new RegExp(`/players/${playerId}/proof-sheets$`));
  });

  test('creates a sheet with an empty body', async () => {
    let lastRequest: Request | undefined;
    const api = createProofSheetApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse(sheetFixture, 201));
    });

    expect(await api.createProofSheet(playerId)).toEqual(sheetFixture);
    expect(lastRequest?.method).toBe('POST');
    expect(await lastRequest?.json()).toEqual({});
  });

  test('revoke resolves on 204 without parsing a body', async () => {
    const api = createProofSheetApi(() => Promise.resolve(new Response(null, { status: 204 })));
    await expect(api.revokeProofSheet(proofSheetId)).resolves.toBeUndefined();
  });

  test('the shared read sends no credentials', async () => {
    let lastRequest: Request | undefined;
    const api = createSharedProofSheetApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse(sharedFixture));
    });

    expect(await api.getShared('t'.repeat(43))).toEqual(sharedFixture);
    expect(lastRequest?.credentials).toBe('omit');
    expect(lastRequest?.url).toMatch(new RegExp(`/shared/proof-sheets/${'t'.repeat(43)}$`));
  });
});

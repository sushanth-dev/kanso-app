/**
 * ST-037. The composer decisions, with no database: which stream wins, what the
 * refusal says, and the token's shape.
 */
import { describe, expect, test } from 'vitest';
import {
  composeSharedProofSheet,
  generateToken,
  pickStream,
  type MeasuredStream,
} from './compose.ts';

const started = new Date('2026-08-01T00:00:00Z');

function stream(
  over: Partial<MeasuredStream> & { stream: MeasuredStream['stream'] },
): MeasuredStream {
  return {
    unit: 'share converted',
    trend: 'flat',
    windowGames: 10,
    gamesBefore: 10,
    baselineValue: 0.5,
    currentValue: 0.55,
    periodStart: new Date('2026-07-01T00:00:00Z'),
    periodEnd: new Date('2026-08-20T00:00:00Z'),
    ...over,
  };
}

const refusal = (over: Partial<MeasuredStream> & { stream: MeasuredStream['stream'] }) =>
  stream({
    trend: 'insufficient_evidence',
    baselineValue: null,
    currentValue: null,
    periodStart: null,
    periodEnd: null,
    ...over,
  });

describe('pickStream', () => {
  test('a verdict beats a refusal', () => {
    const refused = refusal({ stream: 'tournament', windowGames: 4, gamesBefore: 10 });
    const verdict = stream({ stream: 'online' });
    expect(pickStream([refused, verdict]).stream).toBe('online');
  });

  test('among verdicts the catalogue order settles it', () => {
    const first = stream({ stream: 'tournament' });
    const second = stream({ stream: 'online', trend: 'improving' });
    expect(pickStream([first, second]).stream).toBe('tournament');
  });

  test('among refusals the most evidenced wins', () => {
    const thin = refusal({ stream: 'tournament', windowGames: 2, gamesBefore: 8 });
    const thick = refusal({ stream: 'online', windowGames: 6, gamesBefore: 9 });
    expect(pickStream([thin, thick]).stream).toBe('online');
  });
});

describe('composeSharedProofSheet', () => {
  test('freezes the before-and-after numbers and the period', () => {
    const result = composeSharedProofSheet({
      playerDisplayName: 'Sushanth Kamabathula',
      focusTitle: 'Convert won positions',
      coachInstruction: null,
      startedAt: started,
      measurements: [stream({ stream: 'tournament' })],
    });
    expect(result.stream).toBe('tournament');
    expect(result.snapshot).toEqual({
      playerDisplayName: 'Sushanth Kamabathula',
      focusTitle: 'Convert won positions',
      coachInstruction: null,
      stream: 'tournament',
      unit: 'share converted',
      beforeValue: 0.5,
      afterValue: 0.55,
      trend: 'flat',
      gamesBefore: 10,
      gamesAfter: 10,
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-08-20T00:00:00.000Z',
    });
  });

  test('serves a refusal honestly, never zeros or a 404', () => {
    const result = composeSharedProofSheet({
      playerDisplayName: 'Sushanth Kamabathula',
      focusTitle: 'Convert won positions',
      coachInstruction: 'Finish the game before the clock does',
      startedAt: started,
      measurements: [refusal({ stream: 'tournament', windowGames: 3, gamesBefore: 4 })],
    });
    expect(result.snapshot.trend).toBe('insufficient_evidence');
    expect(result.snapshot.beforeValue).toBeNull();
    expect(result.snapshot.afterValue).toBeNull();
    expect(result.snapshot.gamesBefore).toBe(4);
    expect(result.snapshot.gamesAfter).toBe(3);
    // The period falls back to the commitment date when a half is empty.
    expect(result.snapshot.periodStart).toBe('2026-08-01T00:00:00.000Z');
    expect(result.snapshot.periodEnd).toBe('2026-08-01T00:00:00.000Z');
  });
});

describe('generateToken', () => {
  test('is at least 32 characters and unique across draws', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()));
    for (const token of tokens) {
      expect(token.length).toBeGreaterThanOrEqual(32);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
    }
    expect(tokens.size).toBe(100);
  });
});

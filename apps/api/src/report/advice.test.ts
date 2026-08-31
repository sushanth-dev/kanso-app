/**
 * ST-099. The mechanical guard around the model-written advice: only numbers
 * and SAN tokens from the fact set survive, and the retry ladder caps at one
 * corrective attempt before the template copy takes over.
 */
import { describe, expect, test, vi } from 'vitest';
import { adviceIsValid, generateAdvice } from './advice.ts';
import type { ReportAdviceFacts } from '../coaching/zai.ts';

const facts: ReportAdviceFacts = {
  kind: 'motif',
  label: 'Hanging piece',
  occurrences: 23,
  halfPointsLost: 5.5,
  gamesAffected: 7,
  ratingLeak: 800,
  saturated: true,
  gamesCovered: 28,
  instances: [
    { moveNumber: 27, moveSan: 'Rxc4', bestMoveSan: 'g5', judgement: 'mistake', cpLoss: 200 },
    { moveNumber: 45, moveSan: 'Qxc4', bestMoveSan: 'Qe3', judgement: 'blunder', cpLoss: 301 },
    { moveNumber: 46, moveSan: 'bxa4', bestMoveSan: 'Ra1', judgement: 'mistake', cpLoss: 230 },
  ],
};

const phaseFacts: ReportAdviceFacts = {
  kind: 'phase',
  label: 'Middlegame',
  occurrences: 5,
  halfPointsLost: 3,
  gamesAffected: 4,
  ratingLeak: 120,
  saturated: false,
  gamesCovered: 28,
  instances: [
    { moveNumber: 30, moveSan: 'f4', bestMoveSan: 'Nf3', judgement: 'inaccuracy', cpLoss: 90 },
  ],
};

const fakeAi = (batches: (string[] | Error)[]) => {
  let call = 0;
  const adviseWeaknesses = vi.fn(() => {
    const batch = batches[Math.min(call++, batches.length - 1)]!;
    return batch instanceof Error ? Promise.reject(batch) : Promise.resolve(batch);
  });
  const client = {
    explainMistake: vi.fn(),
    askSocraticQuestion: vi.fn(),
    adviseWeaknesses,
    summarizeReport: vi.fn(),
  };
  return { client, adviseWeaknesses };
};

describe('adviceIsValid', () => {
  test('accepts a line built from the fact set', () => {
    expect(
      adviceIsValid(
        'Slow down in the move 45-46 stretch: test every capture against a defender first, ' +
          'because 23 pieces left undefended cost you at least 800 rating points.',
        facts,
      ),
    ).toBe(true);
  });

  test('accepts a plain line with no numbers and no moves', () => {
    expect(adviceIsValid('Check what each of your pieces defends before you move.', facts)).toBe(
      true,
    );
  });

  test('rejects a move window the instances do not support', () => {
    expect(adviceIsValid('Slow down around moves 10-25: check captures first.', facts)).toBe(false);
  });

  test('rejects a SAN that appears nowhere in the instances', () => {
    expect(adviceIsValid('Move 45 - Qxd5 was better; Qe3 hangs nothing.', facts)).toBe(false);
  });

  test('rejects a third sentence', () => {
    expect(adviceIsValid('One. Two. Three.', facts)).toBe(false);
  });

  test('rejects a number that appears nowhere in the fact set', () => {
    expect(adviceIsValid('Compare with game 123456 later.', facts)).toBe(false);
  });

  test('rejects empty text', () => {
    expect(adviceIsValid('   ', facts)).toBe(false);
  });
});

describe('generateAdvice', () => {
  test('keeps valid lines in order', async () => {
    const { client, adviseWeaknesses } = fakeAi([['Motif line.', 'Phase line.']]);
    const out = await generateAdvice(client, [facts, phaseFacts]);
    expect(out).toEqual(['Motif line.', 'Phase line.']);
    expect(adviseWeaknesses).toHaveBeenCalledOnce();
  });

  test('retries once for invalid lines and accepts the corrected ones', async () => {
    const { client, adviseWeaknesses } = fakeAi([
      ['Slow down around moves 10-25.'],
      ['Slow down in the move 45-46 stretch.'],
    ]);
    const out = await generateAdvice(client, [facts]);
    expect(out).toEqual(['Slow down in the move 45-46 stretch.']);
    expect(adviseWeaknesses).toHaveBeenCalledTimes(2);
  });

  test('falls back to null after a failed retry', async () => {
    const { client, adviseWeaknesses } = fakeAi([
      ['Slow down around moves 10-25.'],
      ['Still wrong: moves 10-25.'],
    ]);
    const out = await generateAdvice(client, [facts]);
    expect(out).toEqual([null]);
    expect(adviseWeaknesses).toHaveBeenCalledTimes(2);
  });

  test('does not retry a thrown batch call', async () => {
    const { client, adviseWeaknesses } = fakeAi([new Error('Z.AI down')]);
    const out = await generateAdvice(client, [facts]);
    expect(out).toEqual([null]);
    expect(adviseWeaknesses).toHaveBeenCalledOnce();
  });
});

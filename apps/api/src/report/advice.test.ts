/**
 * ST-099. The mechanical guard around the model-written advice: only numbers
 * and SAN tokens from the fact set survive, and the retry ladder caps at one
 * corrective attempt before the template copy takes over.
 *
 * ST-177. The same rule protects the coaching routes' two texts, so the check
 * reports its reason and the coaching allowlists are built here.
 */
import { describe, expect, test, vi } from 'vitest';
import {
  adviceIsValid,
  checkTextWithinFacts,
  generateAdvice,
  mistakeFactTokens,
  textWithinFacts,
} from './advice.ts';
import type { MistakeFacts, ReportAdviceFacts } from '../coaching/zai.ts';

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
    verifyAdviceSummary: vi.fn(),
    recommendResources: vi.fn(),
    verifyResourceAssessment: vi.fn(),
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

/**
 * ST-177. The rule as the coaching routes read it: `null` when the text may be
 * served, otherwise why not, with the invented token named for the log.
 */
describe('checkTextWithinFacts', () => {
  const numbers = new Set(['3', '230', '0.3', '2.0']);
  const sans = new Set(['Qf6', 'Nc6']);

  test('passes a text built from the facts', () => {
    expect(checkTextWithinFacts('Qf6 cost you 230 centipawns.', numbers, sans, 3)).toBeNull();
  });

  test('reads no number out of a move: Qf6 and Nc6 each print a 6', () => {
    // The allowlist holds no 6, so a check that scanned the raw text would
    // refuse a faithful reply for inventing the move's rank.
    expect(
      checkTextWithinFacts('Nc6 was the move; Qf6 was not.', new Set(['230']), sans, 3),
    ).toBeNull();
  });

  test('names an invented number', () => {
    expect(checkTextWithinFacts('You lost 900 centipawns.', numbers, sans, 3)).toEqual({
      reason: 'token',
      token: '900',
    });
  });

  test('names an invented move', () => {
    expect(checkTextWithinFacts('You should have played Bd3.', numbers, sans, 3)).toEqual({
      reason: 'token',
      token: 'Bd3',
    });
  });

  test('reports the cap rather than a token when the text runs long', () => {
    expect(checkTextWithinFacts('One. Two. Three. Four.', numbers, sans, 3)).toEqual({
      reason: 'sentences',
    });
  });

  test('reports empty text', () => {
    expect(checkTextWithinFacts('   ', numbers, sans, 3)).toEqual({ reason: 'empty' });
  });
});

/**
 * ST-177. The allowlists for one coaching fact set: the numbers the prompt
 * prints, including the evals it renders as pawns, and the two moves it names.
 */
describe('mistakeFactTokens', () => {
  const facts: MistakeFacts = {
    moveNumber: 3,
    movingColor: 'black',
    phase: 'opening',
    moveSan: 'Qf6',
    bestMoveSan: 'Nc6',
    judgement: 'blunder',
    evalBeforeCp: 30,
    evalBeforeMate: null,
    evalAfterCp: -200,
    evalAfterMate: null,
    cpLoss: 230,
    motif: 'hanging_piece',
    opening: 'Sicilian Defense',
    eco: 'B20',
  };

  test('allows the numbers and moves the fact block prints', () => {
    const { numbers, sans } = mistakeFactTokens(facts);
    // The 2.0 is the unsigned form of `evalAfterCp: -200`, which the prompt
    // prints as "-2.0 pawns": a reply saying "down 2.0 pawns" carries 2.0.
    expect([...numbers].sort()).toEqual(['0.3', '2.0', '230', '3']);
    expect([...sans].sort()).toEqual(['Nc6', 'Qf6']);
  });

  test('a mate distance stands in for the eval it replaced', () => {
    const { numbers } = mistakeFactTokens({ ...facts, evalAfterMate: -3 });
    expect(numbers.has('3')).toBe(true);
  });

  test('an eval we do not have contributes no number', () => {
    const { numbers } = mistakeFactTokens({ ...facts, evalBeforeCp: null, evalAfterCp: null });
    expect([...numbers].sort()).toEqual(['230', '3']);
  });

  test('a faithful sentence about the eval passes the check', () => {
    const { numbers, sans } = mistakeFactTokens(facts);
    expect(
      textWithinFacts('Qf6 left you down 2.0 pawns; Nc6 was the way to develop.', numbers, sans, 3),
    ).toBe(true);
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

/**
 * ST-100. The mechanical guard around the model-written report plan: every
 * number and SAN token must come from the fact set, the plan caps at three
 * sentences, and the retry ladder gives the model one corrective attempt
 * before the report ships with no plan at all.
 */
import { describe, expect, test, vi } from 'vitest';
import type { AiClient, ReportSummaryFacts } from '../coaching/zai.ts';
import { generateSummary, summaryIsValid } from './summary.ts';

const facts: ReportSummaryFacts = {
  gamesCovered: 28,
  timeTroubleFromMove: 38,
  weaknesses: [
    {
      kind: 'motif',
      label: 'Hanging piece',
      eco: null,
      occurrences: 23,
      halfPointsLost: 5.5,
      gamesAffected: 7,
      ratingLeak: 800,
      saturated: true,
      advice: 'Count defenders on every piece after each opponent move.',
      instances: [
        { moveNumber: 45, moveSan: 'Qxc4', bestMoveSan: 'Qe3', judgement: 'blunder', cpLoss: 301 },
      ],
    },
    {
      kind: 'opening',
      label: 'Sicilian, Alapin',
      eco: 'B22',
      occurrences: 5,
      halfPointsLost: 1.5,
      gamesAffected: 4,
      ratingLeak: 90,
      saturated: false,
      advice: null,
      instances: [],
    },
  ],
};

describe('summaryIsValid', () => {
  test('accepts a plan built from the fact set', () => {
    expect(
      summaryIsValid(
        'Start with the hanging piece at move 45, then look at the Alapin games; ' +
          'around move 38 your clock starts to bite.',
        facts,
      ),
    ).toBe(true);
  });

  test('accepts the digits of an ECO code the facts carry', () => {
    expect(summaryIsValid('Your 22 Alapin games show the pattern.', facts)).toBe(true);
  });

  test('rejects a number that appears nowhere in the fact set', () => {
    expect(summaryIsValid('Fix the 99 blunders this month.', facts)).toBe(false);
  });

  test('rejects a SAN that appears nowhere in the instances', () => {
    expect(summaryIsValid('Move 45 - Qxd5 was better; study it.', facts)).toBe(false);
  });

  test('rejects a fourth sentence', () => {
    expect(summaryIsValid('One. Two. Three. Four.', facts)).toBe(false);
  });

  test('rejects empty text', () => {
    expect(summaryIsValid('   ', facts)).toBe(false);
  });
});

describe('generateSummary', () => {
  const fakeAi = (answers: (string | Error)[]) => {
    let call = 0;
    const summarizeReport = vi.fn(() => {
      const answer = answers[Math.min(call++, answers.length - 1)]!;
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    });
    const client: AiClient = {
      explainMistake: () => Promise.reject(new Error('not used here')),
      askSocraticQuestion: () => Promise.reject(new Error('not used here')),
      adviseWeaknesses: () => Promise.reject(new Error('not used here')),
      summarizeReport,
      verifyAdviceSummary: () => Promise.reject(new Error('not used here')),
      recommendResources: () => Promise.reject(new Error('not used here')),
      verifyResourceAssessment: () => Promise.reject(new Error('not used here')),
    };
    return { client, summarizeReport };
  };

  test('accepts a valid first attempt', async () => {
    const { client, summarizeReport } = fakeAi(['Start with the hanging piece at move 45.']);
    const plan = await generateSummary(client, facts);
    expect(plan).toBe('Start with the hanging piece at move 45.');
    expect(summarizeReport).toHaveBeenCalledOnce();
  });

  test('accepts the corrected second attempt after an invalid first', async () => {
    const { client, summarizeReport } = fakeAi([
      'Fix the 99 blunders.',
      'Start with the hanging piece at move 45.',
    ]);
    const plan = await generateSummary(client, facts);
    expect(plan).toBe('Start with the hanging piece at move 45.');
    expect(summarizeReport).toHaveBeenCalledTimes(2);
  });

  test('returns null after a failed retry', async () => {
    const { client, summarizeReport } = fakeAi(['Fix the 99 blunders.', 'Still 99 blunders.']);
    const plan = await generateSummary(client, facts);
    expect(plan).toBeNull();
    expect(summarizeReport).toHaveBeenCalledTimes(2);
  });

  test('does not retry a thrown first call', async () => {
    const { client, summarizeReport } = fakeAi([new Error('Z.AI down')]);
    const plan = await generateSummary(client, facts);
    expect(plan).toBeNull();
    expect(summarizeReport).toHaveBeenCalledOnce();
  });
});

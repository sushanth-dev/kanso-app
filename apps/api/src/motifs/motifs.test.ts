/**
 * ST-024. The pure scoring: threshold, ranking, and the two empty cases.
 *
 * No database, no clock, so the rules the coach sees are pinned without a
 * server. The query side of the split is covered by the integration test.
 */
import { describe, expect, test } from 'vitest';
import { MIN_POSITIONS, scoreMotifs, type MotifCount } from './motifs.ts';

function count(motif: MotifCount['motif'], positions: number, totalLoss: number): MotifCount {
  return { motif, positions, totalLoss };
}

describe('scoreMotifs', () => {
  test('a player with no analysed games is refused, not answered', () => {
    expect(scoreMotifs({ completeGames: 0, counts: [], unattributed: 0 })).toEqual({
      kind: 'not_enough_evidence',
    });
  });

  test('analysed games with no mistakes is a clean bill, not a refusal', () => {
    expect(scoreMotifs({ completeGames: 3, counts: [], unattributed: 0 })).toEqual({
      kind: 'ok',
      motifs: [],
      unattributed: 0,
      mistakeCount: 0,
      withheld: 0,
    });
  });

  test('withholds a motif under the threshold and counts the withheld ones', () => {
    const result = scoreMotifs({
      completeGames: 10,
      counts: [
        count('hanging_piece', 4, 800),
        count('missed_capture', 2, 300),
        count('missed_check', 1, 100),
      ],
      unattributed: 3,
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.motifs).toEqual([{ motif: 'hanging_piece', positions: 4, totalCpLoss: 800 }]);
    expect(result.withheld).toBe(2);
    // Every mistake counts toward the total, withheld or not.
    expect(result.mistakeCount).toBe(4 + 2 + 1 + 3);
    expect(result.unattributed).toBe(3);
  });

  test('ranks by cost, worst first, breaking ties by motif name', () => {
    const result = scoreMotifs({
      completeGames: 10,
      counts: [
        count('missed_check', 5, 400),
        count('missed_capture', 4, 400),
        count('hanging_piece', 3, 900),
      ],
      unattributed: 0,
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.motifs.map((m) => m.motif)).toEqual([
      'hanging_piece',
      'missed_capture',
      'missed_check',
    ]);
  });

  test('the threshold constant is the number the story decided', () => {
    expect(MIN_POSITIONS).toBe(3);
  });
});

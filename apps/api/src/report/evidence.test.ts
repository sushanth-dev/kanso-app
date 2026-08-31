/**
 * ST-098. The advice line must never contradict the places beneath it: the
 * middlegame's "slow down" head names the move stretch the evidence actually
 * clusters in, not a hard-coded heuristic window.
 *
 * No database. The evidence query itself is pinned by the integration suite.
 */
import { describe, expect, test } from 'vitest';
import { adviceFor, type EvidenceInstance } from './evidence.ts';

function instance(moveNumber: number): EvidenceInstance {
  return {
    gameId: '00000000-0000-4000-8000-000000000000',
    whiteName: null,
    blackName: null,
    playedAt: null,
    moveNumber,
    ply: (moveNumber - 1) * 2 + 2,
    moveSan: 'Qxc4',
    bestMoveSan: 'Qe3',
    phase: 'middlegame',
    judgement: 'blunder',
    cpLoss: 300,
  };
}

describe('adviceFor', () => {
  test('middlegame names the stretch the instances span', () => {
    const advice = adviceFor('phase', 'middlegame', [instance(45), instance(46), instance(27)]);
    expect(advice).toContain('move 27-46 stretch');
    expect(advice).toContain('pick a candidate move');
    expect(advice).not.toContain('10-25');
  });

  test('a single instance reads as one move, not a stretch', () => {
    expect(adviceFor('phase', 'middlegame', [instance(45)])).toContain('around move 45');
  });

  test('without instances the middlegame line stays honest by dropping the window', () => {
    const advice = adviceFor('phase', 'middlegame', []);
    expect(advice).toContain('Slow down before committing to a move');
    expect(advice).not.toMatch(/move \d/);
  });

  test('opening has no advice and unknown groups fall back to the generic line', () => {
    expect(adviceFor('opening', 'B01')).toBeNull();
    expect(adviceFor('motif', 'unknown_key')).toContain('repetition');
  });
});

/**
 * ST-154. The missed-punishment rule, pinned so a threshold cannot drift
 * unnoticed and so the colour invariant - only the opponent's plies are ever
 * candidates - is tested directly.
 *
 * No database, no clock, no engine: these are the games a coach will ask
 * about, answered with the constants they map to. Evaluations are
 * white-absolute, the classifier's own convention; the detector flips them to
 * the player's perspective. Each ply stores the evaluation *before* it is
 * played, so the boundary after ply n is the eval stored on ply n+1.
 */
import { describe, expect, test } from 'vitest';
import {
  GAINED_ADVANTAGE_CP,
  HOLD_FLOOR_CP,
  detectMissedPunishments,
  type PunishmentPly,
} from './missed-punishment.ts';

function cp(
  n: number,
  movingColor: 'white' | 'black',
  evalCp: number,
  phase: 'opening' | 'middlegame' | 'endgame' = 'middlegame',
): PunishmentPly {
  return { ply: n, movingColor, evalCp, evalMate: null, phase };
}

function mate(n: number, movingColor: 'white' | 'black', evalMate: number): PunishmentPly {
  return { ply: n, movingColor, evalCp: null, evalMate, phase: 'middlegame' };
}

describe('detectMissedPunishments', () => {
  test('the opponent blunders into a winning position and it is converted: no miss', () => {
    // Black blunders at ply 4: white's evaluation swings +30 to +400, well
    // past the gain threshold. White keeps the position above the hold floor
    // to the end of the game.
    const plies = [
      cp(1, 'white', 30),
      cp(2, 'black', 30),
      cp(3, 'white', 30),
      cp(4, 'black', 30),
      cp(5, 'white', 400), // the gain position
      cp(6, 'black', 390),
      cp(7, 'white', 400),
      cp(8, 'black', 395),
    ];
    expect(detectMissedPunishments('white', plies)).toEqual([]);
  });

  test('the opponent blunders and the advantage slips: one miss pointing at the slip', () => {
    // Black blunders at ply 4 (+30 to +400). White's ply 5 throws it back:
    // the boundary before ply 6 is +40, under the hold floor. The miss points
    // at the blunder ply (the deep link) and carries the slip ply and phase.
    const plies = [
      cp(1, 'white', 30),
      cp(2, 'black', 30),
      cp(3, 'white', 30),
      cp(4, 'black', 30),
      cp(5, 'white', 400),
      cp(6, 'black', 40), // the first boundary under the floor
      cp(7, 'white', 40),
      cp(8, 'black', 35),
    ];
    expect(detectMissedPunishments('white', plies)).toEqual([
      { blunderPly: 4, slipPly: 6, slipPhase: 'middlegame' },
    ]);
  });

  test('the gain must clear the threshold: an advantage under the bar is not a miss', () => {
    // Black blunders from a lost position (-250) back to +140: a genuine
    // Blunder by the classifier (cpLoss 390), but the resulting advantage
    // sits under GAINED_ADVANTAGE_CP, so no hold window opens even though a
    // later boundary dips below the hold floor.
    const plies = [
      cp(1, 'white', -250),
      cp(2, 'black', -250),
      cp(3, 'white', -250),
      cp(4, 'black', -250),
      cp(5, 'white', GAINED_ADVANTAGE_CP - 10), // +140: under the bar
      cp(6, 'black', 20), // would be a slip if the window had opened
      cp(7, 'white', 20),
      cp(8, 'black', 15),
    ];
    expect(detectMissedPunishments('white', plies)).toEqual([]);
  });

  test('the gain at exactly the threshold opens the hold window', () => {
    // The gain comparison is inclusive: exactly GAINED_ADVANTAGE_CP counts.
    // The blunder comes from -250 so the classifier's cpLoss floor is met.
    const plies = [
      cp(1, 'white', -250),
      cp(2, 'black', -250),
      cp(3, 'white', -250),
      cp(4, 'black', -250),
      cp(5, 'white', GAINED_ADVANTAGE_CP),
      cp(6, 'black', 40),
      cp(7, 'white', 40),
      cp(8, 'black', 35),
    ];
    expect(detectMissedPunishments('white', plies)).toEqual([
      { blunderPly: 4, slipPly: 6, slipPhase: 'middlegame' },
    ]);
  });

  test('a boundary at exactly the hold floor is held; only one under it slips', () => {
    // The floor comparison is exclusive: staying at exactly HOLD_FLOOR_CP
    // holds. The game holds at exactly +50, then white's ply 9 slips and the
    // boundary after it (stored on ply 10) falls to +49. Every earlier
    // boundary, including the one before white's slip move, sits exactly on
    // the floor.
    const plies = [
      cp(1, 'white', 30),
      cp(2, 'black', 30),
      cp(3, 'white', 30),
      cp(4, 'black', 30),
      cp(5, 'white', 400),
      cp(6, 'black', HOLD_FLOOR_CP), // exactly the floor: held
      cp(7, 'white', HOLD_FLOOR_CP),
      cp(8, 'black', HOLD_FLOOR_CP),
      cp(9, 'white', HOLD_FLOOR_CP), // still held when white is to move
      cp(10, 'black', 49), // the boundary after white's slip
    ];
    expect(detectMissedPunishments('white', plies)).toEqual([
      { blunderPly: 4, slipPly: 10, slipPhase: 'middlegame' },
    ]);
  });

  test('the slip is the first boundary under the floor, not the last', () => {
    const plies = [
      cp(1, 'white', 30),
      cp(2, 'black', 30),
      cp(3, 'white', 30),
      cp(4, 'black', 30),
      cp(5, 'white', 400),
      cp(6, 'black', 45), // first under the floor
      cp(7, 'white', 200), // white claws some back
      cp(8, 'black', 30), // a later boundary, further gone
    ];
    expect(detectMissedPunishments('white', plies)).toEqual([
      { blunderPly: 4, slipPly: 6, slipPhase: 'middlegame' },
    ]);
  });

  test('a player blunder is never a candidate: the colour invariant', () => {
    // White (the player) blunders at ply 3, dropping the eval to -400. From
    // the opponent's side that is a gained advantage that was kept, but the
    // detector only considers the opponent's plies, so nothing is produced.
    const plies = [
      cp(1, 'white', 0),
      cp(2, 'black', 0),
      cp(3, 'white', -400),
      cp(4, 'black', -400),
      cp(5, 'white', -400),
      cp(6, 'black', -395),
    ];
    expect(detectMissedPunishments('white', plies)).toEqual([]);
  });

  test('a blunder on the last ply has no stored after-evaluation and is skipped', () => {
    const plies = [
      cp(1, 'white', 30),
      cp(2, 'black', 30),
      cp(3, 'white', 30),
      cp(4, 'black', 30),
      cp(5, 'white', 400), // would be the gain if a boundary followed
    ];
    expect(detectMissedPunishments('white', plies)).toEqual([]);
  });

  test('a mate gain counts, and standing mate never slips', () => {
    // Black blunders into mate-in-3 for white. The gain boundary is mate in
    // the player's favour; the hold boundaries stay mate, and mate never
    // decays, so the conversion holds to the end.
    const plies = [
      cp(1, 'white', 30),
      cp(2, 'black', 30),
      cp(3, 'white', 30),
      cp(4, 'black', 30),
      mate(5, 'white', 3),
      mate(6, 'black', 3),
      mate(7, 'white', 3),
    ];
    expect(detectMissedPunishments('white', plies)).toEqual([]);
  });

  test('a mate gain that falls back under the floor is missed', () => {
    // Black blunders, white reaches mate-in-2, then white lets the mate go
    // and the boundary falls to +40: under the hold floor.
    const plies = [
      cp(1, 'white', 30),
      cp(2, 'black', 30),
      cp(3, 'white', 30),
      cp(4, 'black', 30),
      mate(5, 'white', 2),
      cp(6, 'black', 40), // the first boundary under the floor
      cp(7, 'white', 40),
      cp(8, 'black', 35),
    ];
    expect(detectMissedPunishments('white', plies)).toEqual([
      { blunderPly: 4, slipPly: 6, slipPhase: 'middlegame' },
    ]);
  });

  test('a mate against the player keeps every boundary below the gain bar', () => {
    // Black blunders into a position where white is mated: mate against the
    // player reads as the furthest possible disadvantage, so the gain bar is
    // never met and nothing is detected.
    const plies = [
      cp(1, 'white', 30),
      cp(2, 'black', 30),
      cp(3, 'white', 30),
      cp(4, 'black', 30),
      mate(5, 'white', -3), // mate in 3 against white
      mate(6, 'black', -3),
    ];
    expect(detectMissedPunishments('white', plies)).toEqual([]);
  });

  test('the black player perspective: white blunders, black holds', () => {
    // The player is black. White's ply 3 drops the white-absolute eval from
    // +30 to -400, a +400 player-perspective gain that black keeps above the
    // floor (white-absolute -400 or worse) to the end.
    const plies = [
      cp(1, 'white', 30),
      cp(2, 'black', 30),
      cp(3, 'white', 30), // white's before-eval; its move lands the next boundary
      cp(4, 'black', -400), // the after-boundary: white blundered
      cp(5, 'white', -400),
      cp(6, 'black', -400),
      cp(7, 'white', -400),
      cp(8, 'black', -395),
    ];
    expect(detectMissedPunishments('black', plies)).toEqual([]);
  });

  test('the black player perspective: white blunders, black slips', () => {
    // White's ply 3 blunders to -400 (a +400 gain for black), then black's
    // ply 5 lets the boundary after it (stored on ply 6) fall to -40, which
    // is only +40 in black's perspective: under the floor.
    const plies = [
      cp(1, 'white', 30),
      cp(2, 'black', 30),
      cp(3, 'white', 30), // white's before-eval
      cp(4, 'black', -400), // the blunder's after-boundary and the gain position
      cp(5, 'white', -400), // still held when black is to move
      cp(6, 'black', -40), // the first boundary under the floor
      cp(7, 'white', -35),
    ];
    expect(detectMissedPunishments('black', plies)).toEqual([
      { blunderPly: 3, slipPly: 6, slipPhase: 'middlegame' },
    ]);
  });

  test('the slip phase comes from the slip boundary, so drills route by it', () => {
    const plies = [
      cp(1, 'white', 30, 'opening'),
      cp(2, 'black', 30, 'opening'),
      cp(3, 'white', 30, 'opening'),
      cp(4, 'black', 30, 'opening'),
      cp(5, 'white', 400, 'opening'),
      cp(6, 'black', 40, 'endgame'), // the slip lands in the endgame
      cp(7, 'white', 40, 'endgame'),
      cp(8, 'black', 35, 'endgame'),
    ];
    expect(detectMissedPunishments('white', plies)).toEqual([
      { blunderPly: 4, slipPly: 6, slipPhase: 'endgame' },
    ]);
  });
});

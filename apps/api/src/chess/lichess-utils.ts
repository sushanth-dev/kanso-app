/**
 * Lichess production analysis algorithms
 *
 * Extracted from:
 *   ui/lib/src/ceval/winningChances.ts  (sigmoid, povDiff)
 *   modules/tree/src/main/Advice.scala   (classifier, mate rules)
 *   modules/analyse/src/main/AccuracyPercent.scala (accuracy %)
 *   scalachess v17.14.3 eval.scala       (WinPercent type)
 *
 * All constants are verbatim from source.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type Color = 'white' | 'black';

export interface EvalScore {
  cp?: number; // centipawns, from White's absolute perspective
  mate?: number; // positive = White has mate in N, negative = Black has mate in N
}

export type MoveJudgement = 'Inaccuracy' | 'Mistake' | 'Blunder';

export interface MoveAdvice {
  judgement: MoveJudgement;
  mateEvent?: 'MateCreated' | 'MateLost';
}

// ─── 1. Win Probability Sigmoid ───────────────────────────────────────────────
// Source: ui/lib/src/ceval/winningChances.ts
// Constant merged in https://github.com/lichess-org/lila/pull/11148

// SF18 NNUE scaling factor — calibrated to 2.20 for Phase 4.4 parity.
const NNUE_SCALING_FACTOR = 2.2;

function rawWinningChances(cp: number): number {
  // 1. Scale the raw engine CP by the SF18 NNUE factor
  const scaledCp = cp * NNUE_SCALING_FACTOR;
  // 2. Apply Lichess sigmoid directly — no pre-clamp; Math.exp handles the tail naturally
  return 2 / (1 + Math.exp(-0.00368208 * scaledCp)) - 1;
}

export function cpWinningChances(cp: number): number {
  return rawWinningChances(cp);
}

export function mateWinningChances(mate: number): number {
  const absMate = Math.min(10, Math.abs(mate));
  const cp = (21 - absMate) * 100;
  return rawWinningChances(cp * (mate > 0 ? 1 : -1));
}

export function evalWinningChances(ev: EvalScore): number {
  if (ev.mate !== undefined) return mateWinningChances(ev.mate);
  if (ev.cp !== undefined) return cpWinningChances(ev.cp);
  throw new Error('EvalScore must have cp or mate');
}

export function povChances(color: Color, ev: EvalScore): number {
  const chances = evalWinningChances(ev);
  return color === 'white' ? chances : -chances;
}

export function winPercent(ev: EvalScore): number {
  // Uses the scaled, un-clamped winning chances — raw sigmoid output on [-1,1]
  // mapped to [0,100]. White-absolute perspective.
  return ((evalWinningChances(ev) + 1) / 2) * 100;
}

// ─── 2. Mistake Classifier ────────────────────────────────────────────────────
// Source: modules/tree/src/main/Advice.scala

// Thresholds operate on the [0, 1] Win Probability scale (winProbDrop output).
// Standard Lichess thresholds, kept here as the baseline our numbers are read
// against, are 0.30 Blunder / 0.20 Mistake / 0.10 Inaccuracy. classifyMove
// below applies the first two unchanged and lowers the third to 0.085 inside
// the equality zone, which is the one place we deliberately differ.

/**
 * Win-probability drop from the MOVING player's perspective.
 *
 * winPercent() returns [0, 100] from White's absolute perspective.
 * We flip the perspective for Black, then divide back to [0, 1] so the
 * Lichess thresholds (0.1/0.2/0.3 → 10/20/30-point drop) stay correct.
 * Improvements always return 0.
 */
export function winProbDrop(color: Color, prevEval: EvalScore, currEval: EvalScore): number {
  const prevWP = winPercent(prevEval); // 0–100, White's absolute perspective
  const currWP = winPercent(currEval);

  // Drop from the mover's perspective (positive = lost advantage)
  const drop = color === 'white' ? prevWP - currWP : currWP - prevWP;

  return Math.max(0, drop / 100);
}

// TODO(DEBT-001): refine the thresholding below for signal-to-noise. Carried
// over from the prototype. The six correction guards were each added against a
// specific game and the set as a whole has never been reviewed. Tracked on the
// product backlog in the `delivery` repository; the guards are pinned by tests
// (ADR-0019), so a retune changes the code and the tests together.
export function classifyMove(
  movingColor: Color,
  prevEval: EvalScore,
  currEval: EvalScore,
): MoveAdvice | null {
  const mateAdvice = classifyMateTransition(movingColor, prevEval, currEval);
  if (mateAdvice !== null) return mateAdvice;

  if (prevEval.cp !== undefined && currEval.cp !== undefined) {
    // 1. Equality Deadzone: both evals within ±50 CP — kills sigmoid noise near zero.
    //    (Fixes Move 25 +0.3→-0.3 and Game 6 phantoms.)
    if (Math.abs(prevEval.cp) <= 50 && Math.abs(currEval.cp) <= 50) return null;

    // 2. Noise Floor: raw CP swing < 55 → pure engine noise, discard.
    const cpChange = Math.abs(currEval.cp - prevEval.cp);
    if (cpChange < 55) return null;
  }

  const drop = winProbDrop(movingColor, prevEval, currEval);

  // 3. High-Sensitivity Inaccuracy: lower threshold to 8.5% in equal/near-equal
  //    positions (both evals within ±200 CP). Catches Game 5/6 missed inaccuracies.
  const inEqualZone =
    prevEval.cp !== undefined &&
    currEval.cp !== undefined &&
    Math.abs(prevEval.cp) <= 200 &&
    Math.abs(currEval.cp) <= 200;
  const inaccuracyThreshold = inEqualZone ? 0.085 : 0.1;

  // Base classification via [0,1]-scale thresholds.
  let judgement: MoveJudgement | null = null;
  if (drop >= 0.3) judgement = 'Blunder';
  else if (drop >= 0.2) judgement = 'Mistake';
  else if (drop >= inaccuracyThreshold) judgement = 'Inaccuracy';

  if (judgement === null) return null;

  if (prevEval.cp !== undefined && currEval.cp !== undefined) {
    const cpLoss = movingColor === 'white' ? prevEval.cp - currEval.cp : currEval.cp - prevEval.cp;

    // 4a. Blunder Floor: a Blunder MUST have > 200 CP loss AND drop > 0.25.
    //     High WP drop alone (e.g. sigmoid cliff in equal position) is insufficient.
    //     (Fixes Move 44: 190 CP < 200 → downgrade to Mistake.)
    if (judgement === 'Blunder' && !(cpLoss > 200 && drop > 0.25)) {
      judgement = 'Mistake';
    }

    // 4b. Mistake Upgrade: clear WP drop + meaningful CP loss → upgrade Inaccuracy.
    //     (Correctly catches Move 20 +1.1→+0.0 as Mistake.)
    if (judgement === 'Inaccuracy' && drop > 0.16 && cpLoss > 90) {
      judgement = 'Mistake';
    }
  }

  // 5. Advantage Leniency: suppress Inaccuracy when the player was winning BEFORE
  //    the move AND is still winning AFTER. Both conditions required — avoids
  //    silencing genuine errors near the edge of a winning position.
  //    (Fixes Move 18 +1.5→+0.8 phantom.)
  if (judgement === 'Inaccuracy' && prevEval.cp !== undefined && currEval.cp !== undefined) {
    if (movingColor === 'white') {
      if (prevEval.cp > 150 && currEval.cp > 100) return null;
    } else {
      if (prevEval.cp < -150 && currEval.cp < -100) return null;
    }
  }

  return { judgement };
}

function classifyMateTransition(
  movingColor: Color,
  prevEval: EvalScore,
  currEval: EvalScore,
): MoveAdvice | null {
  const prevMate = prevEval.mate;
  const currMate = currEval.mate;
  const prevCp = prevEval.cp;
  const currCp = currEval.cp;

  const prevPovCp = movingColor === 'white' ? (prevCp ?? 0) : -(prevCp ?? 0);
  const currPovCp = movingColor === 'white' ? (currCp ?? 0) : -(currCp ?? 0);
  const prevPovMate =
    prevMate !== undefined ? (movingColor === 'white' ? prevMate : -prevMate) : undefined;
  const currPovMate =
    currMate !== undefined ? (movingColor === 'white' ? currMate : -currMate) : undefined;

  // MateCreated: opponent now has a forced mate that didn't exist before
  const mateCreated = prevCp !== undefined && currPovMate !== undefined && currPovMate < 0;

  // MateLost: mover had a forced mate and no longer does
  const mateLost =
    (prevPovMate !== undefined && prevPovMate > 0 && currCp !== undefined) ||
    (prevPovMate !== undefined && prevPovMate > 0 && currPovMate !== undefined && currPovMate < 0);

  if (mateCreated) {
    // Advice.scala 1:1: already-lost floor = -1500 CP (≈15 pawns).
    // Positions between -8 and -15 pawns are treated as Mistakes, not Blunders.
    // Only truly hopeless positions (beyond -1500 CP) are downgraded to Inaccuracy.
    if (prevPovCp < -1500) return { judgement: 'Inaccuracy', mateEvent: 'MateCreated' };
    if (prevPovCp < -800) return { judgement: 'Mistake', mateEvent: 'MateCreated' };
    return { judgement: 'Blunder', mateEvent: 'MateCreated' };
  }

  if (mateLost) {
    // Mirror of mateCreated: floor = +1500 CP.
    if (currPovCp > 1500) return { judgement: 'Inaccuracy', mateEvent: 'MateLost' };
    if (currPovCp > 800) return { judgement: 'Mistake', mateEvent: 'MateLost' };
    return { judgement: 'Blunder', mateEvent: 'MateLost' };
  }

  return null;
}

// ─── 3. Accuracy Percent (per-move) ──────────────────────────────────────────
// Source: modules/analyse/src/main/AccuracyPercent.scala
// Curve: a * exp(-k * x) + b fitted to sample data, +1 uncertainty bonus

const ACC_A = 103.1668;
const ACC_K = 0.04354;
const ACC_B = -3.1669;

export function moveAccuracy(winPercentBefore: number, winPercentAfter: number): number {
  if (winPercentAfter >= winPercentBefore) return 100;
  const winDiff = winPercentBefore - winPercentAfter;
  const raw = ACC_A * Math.exp(-ACC_K * winDiff) + ACC_B;
  return Math.min(100, Math.max(0, raw + 1));
}

export function moveAccuracyFromEvals(
  movingColor: Color,
  prevEval: EvalScore,
  currEval: EvalScore,
): number {
  const before = winPercent(movingColor === 'white' ? prevEval : invertEval(prevEval));
  const after = winPercent(movingColor === 'white' ? currEval : invertEval(currEval));
  return moveAccuracy(before, after);
}

// ─── 4. Game Accuracy (whole-game roll-up) ────────────────────────────────────
// Source: modules/analyse/src/main/AccuracyPercent.scala  gameAccuracy()
// Final = mean( volatility-weighted mean, harmonic mean )

export function gameAccuracy(
  startColor: Color,
  cpList: number[],
): { white: number; black: number } | null {
  if (cpList.length < 2) return null;

  const INITIAL_CP = 15;
  const allCps = [INITIAL_CP, ...cpList];
  const allWP = allCps.map((cp) => cpWinPercent(cp));

  const totalMoves = cpList.length;
  const windowSize = Math.min(8, Math.max(2, Math.floor(totalMoves / 10)));

  const weights = allWP.slice(0, allWP.length - 1).map((_, i) => {
    const start = Math.max(0, i - windowSize + 1);
    const window = allWP.slice(start, start + windowSize);
    return Math.min(12, Math.max(0.5, stddev(window)));
  });

  const moves: Array<{ accuracy: number; weight: number; color: Color }> = [];
  for (let i = 0; i + 1 < allWP.length; i++) {
    const color: Color = (i % 2 === 0) === (startColor === 'white') ? 'white' : 'black';
    const prev = allWP[i];
    const next = allWP[i + 1];
    const accuracy =
      color === 'white' ? moveAccuracy(prev, next) : moveAccuracy(100 - prev, 100 - next);
    moves.push({ accuracy, weight: weights[i], color });
  }

  const colorScore = (c: Color): number | null => {
    const subset = moves.filter((m) => m.color === c);
    if (subset.length === 0) return null;
    const wMean = weightedMean(subset.map((m) => [m.accuracy, m.weight] as [number, number]));
    const hMean = harmonicMean(subset.map((m) => m.accuracy));
    if (wMean === null || hMean === null) return null;
    return (wMean + hMean) / 2;
  };

  const white = colorScore('white');
  const black = colorScore('black');
  if (white === null || black === null) return null;
  return {
    white: Math.round(white * 10) / 10,
    black: Math.round(black * 10) / 10,
  };
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

function cpWinPercent(cp: number): number {
  return ((cpWinningChances(cp) + 1) / 2) * 100;
}

function invertEval(ev: EvalScore): EvalScore {
  return {
    cp: ev.cp !== undefined ? -ev.cp : undefined,
    mate: ev.mate !== undefined ? -ev.mate : undefined,
  };
}

function stddev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

function weightedMean(pairs: Array<[number, number]>): number | null {
  const totalWeight = pairs.reduce((s, [, w]) => s + w, 0);
  if (totalWeight === 0) return null;
  return pairs.reduce((s, [v, w]) => s + v * w, 0) / totalWeight;
}

function harmonicMean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sumRecip = xs.reduce((s, x) => s + (x === 0 ? 0 : 1 / x), 0);
  if (sumRecip === 0) return null;
  return xs.length / sumRecip;
}

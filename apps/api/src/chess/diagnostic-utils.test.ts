/**
 * Characterisation coverage for the carried-over diagnostic primitives.
 *
 * These two functions (`computeHygiene` and `findCCT`) came over from the
 * prototype untested, and ST-007's engine analysis leans on the same chess
 * physics. This file pins what they do today, before any change, so a later
 * refactor or deepening is a deliberate change to covered code rather than a
 * silent drift.
 *
 * Where the current behaviour is a known compromise it is pinned as such, not
 * blessed. Threat detection (DEBT-005) used to be a static attacker and defender
 * counter that missed two-move threats and reported false positives; it is now
 * a one-ply delta search over ChessOps attack geometry. The tests below record
 * the current shape.
 */
import { describe, expect, test } from 'vitest';
import { computeHygiene, findCCT, hasXrayAttacker } from './diagnostic-utils.ts';

describe('computeHygiene', () => {
  test('counts direct-contact attackers and defenders on the pre-move board', () => {
    // White knight e5 takes black pawn f7; white queen d1 backs f7 on the
    // diagonal, black king e8 defends f7 by adjacency.
    const fen = '4k3/5p2/8/4N3/8/8/8/3QK3 w - - 0 1';
    expect(computeHygiene(fen, 'Nxf7')).toEqual({
      targetSquare: 'f7',
      fromSquare: 'e5',
      attackersDC: 1,
      attackersXC: 0,
      defendersDC: 1,
      defendersXC: 0,
      attackers: 1,
      defenders: 1,
    });
  });

  test('counts an x-ray attacker behind a friendly blocker separately', () => {
    // White rook f1 x-rays f7 through the friendly queen f3; the knight e5
    // and queen f3 are the direct-contact attackers.
    const fen = '4k3/5p2/8/4N3/8/5Q2/8/5RK1 w - - 0 1';
    const result = computeHygiene(fen, 'Nxf7');
    expect(result?.attackersDC).toBe(2);
    expect(result?.attackersXC).toBe(1);
    expect(result?.attackers).toBe(3);
    expect(result?.defenders).toBe(1);
  });

  test('returns null for an unparseable fen', () => {
    expect(computeHygiene('not a fen', 'Nxf7')).toBeNull();
  });

  test('throws on an illegal move, because only the fen is guarded', () => {
    // The fen constructor is wrapped in try/catch but chess.move is not, so an
    // illegal SAN escapes as a thrown error rather than a null. Pinned as-is;
    // a caller that feeds untrusted SAN would need this hardened.
    const fen = '4k3/5p2/8/4N3/8/8/8/3QK3 w - - 0 1';
    expect(() => computeHygiene(fen, 'Nope')).toThrow();
  });
});

describe('hasXrayAttacker', () => {
  test('true when a friendly slider x-rays the target through a friendly blocker', () => {
    // White rook a7 x-rays a8 through the friendly queen a5.
    const fen = '7k/8/8/8/Q7/8/R7/4K3 w - - 0 1';
    expect(hasXrayAttacker(fen, 'a8', 'w')).toBe(true);
  });

  test('false when the blocker is an enemy piece, which a rook cannot x-ray through', () => {
    const fen = '7k/8/8/8/q7/8/R7/4K3 w - - 0 1';
    expect(hasXrayAttacker(fen, 'a8', 'w')).toBe(false);
  });

  test('false for an unparseable fen', () => {
    expect(hasXrayAttacker('bad', 'a8', 'w')).toBe(false);
  });
});

describe('findCCT', () => {
  const fen = '4k3/8/8/4p3/3P4/Q7/8/4K3 w - - 0 1';

  test('splits legal moves into checks, captures, and threats', () => {
    const result = findCCT(fen);
    expect(result.checks.map((m) => m.san)).toEqual(['Qa4+', 'Qa8+', 'Qe7+', 'Qf8+']);
    expect(result.captures.map((m) => m.san)).toEqual(['dxe5']);
    // Every check and capture is also in the combined list, in that order.
    expect(result.all[0]!.type).toBe('Check');
    expect(result.all.some((m) => m.san === 'dxe5' && m.type === 'Capture')).toBe(true);
  });

  test('marks only the engine move as a good option when bestMoveSan is given', () => {
    const result = findCCT(fen, 'Qa4+');
    expect(result.checks.find((m) => m.san === 'Qa4+')?.isGoodOption).toBe(true);
    expect(result.checks.find((m) => m.san === 'Qa8+')?.isGoodOption).toBe(false);
    expect(result.captures.find((m) => m.san === 'dxe5')?.isGoodOption).toBe(false);
  });

  test('returns empty collections for an unparseable fen', () => {
    expect(findCCT('bad')).toEqual({
      checks: [],
      captures: [],
      threats: [],
      all: [],
      usefulCCT: [],
    });
  });

  test('a quiet move that lifts a blocker creates a Material threat', () => {
    // White bishop a2 blocks rook a1's attack on the undefended black rook a8.
    // Moving the bishop away (e.g. Bb3) reveals the rook's attack on a hanging
    // piece, which the one-ply delta search sees.
    const fen = 'r3k3/8/8/8/8/8/B7/R3K3 w - - 0 1';
    const result = findCCT(fen);
    expect(
      result.threats.some((t) => t.san.startsWith('B') && t.threatCategory === 'Material'),
    ).toBe(true);
  });

  test('a quiet move attacking a defended piece is not a threat', () => {
    // The black rook a8 is defended by the king b8, so lifting the bishop does
    // not make it hanging and no threat is reported.
    const fen = '1k2r3/8/8/8/8/8/B7/R3K3 w - - 0 1';
    expect(findCCT(fen).threats).toEqual([]);
  });

  test('a two-move discovered attack is now visible to the delta search', () => {
    // White rook a1 and bishop a3 line up on the undefended black bishop a6.
    // Moving the bishop (e.g. Bb4) reveals the rook's attack on a hanging piece,
    // which the static counter could not see.
    const fen = '4k3/8/b7/8/8/B7/8/R3K3 w - - 0 1';
    const bishopThreats = findCCT(fen).threats.filter((t) => t.san.startsWith('B'));
    expect(bishopThreats.length).toBeGreaterThan(0);
    expect(bishopThreats.every((t) => t.threatCategory === 'Material')).toBe(true);
  });

  test('a quiet king move that creates nothing is not a threat', () => {
    // The rook a1 already attacks the undefended pawn a7, so a quiet king move
    // changes nothing about the hanging set and is not reported as a threat.
    // This is the false positive the delta search removes.
    const fen = '4k3/8/8/8/8/8/p7/R3K3 w - - 0 1';
    const result = findCCT(fen);
    expect(
      result.threats.some((t) => t.san.startsWith('K') && t.threatCategory === 'Material'),
    ).toBe(false);
  });

  test('a quiet move that sets up mate-in-one is a Checkmate threat', () => {
    // White Qh5 -> Qh6 threatens Qxg7# (the queen is defended by the bishop f6).
    const fen = '6k1/5ppp/5B2/7Q/8/8/5PPP/6K1 w - - 0 1';
    const result = findCCT(fen);
    expect(result.threats.find((t) => t.san === 'Qh6')?.threatCategory).toBe('Checkmate');
  });
});

describe('computeHygiene: black to move', () => {
  test('reads the colours from the moving side, not from White', () => {
    // Black knight e5 takes the white pawn f7; the black king e8 backs it up,
    // and no white piece defends f7.
    const fen = '4k3/5P2/8/4n3/8/8/8/3QK3 b - - 0 1';
    expect(computeHygiene(fen, 'Nxf7')).toEqual({
      targetSquare: 'f7',
      fromSquare: 'e5',
      attackersDC: 2,
      attackersXC: 0,
      defendersDC: 0,
      defendersXC: 0,
      attackers: 2,
      defenders: 0,
    });
  });
});

describe('hasXrayAttacker: per-piece transparency rules', () => {
  test('a bishop x-rays through a friendly bishop on a diagonal', () => {
    const fen = '4k3/8/8/8/8/8/3B4/2B1K3 w - - 0 1';
    expect(hasXrayAttacker(fen, 'e3', 'w')).toBe(true);
  });

  test('a rook does not x-ray through a friendly bishop', () => {
    const fen = '7k/8/8/8/8/8/1B6/R3K3 w - - 0 1';
    expect(hasXrayAttacker(fen, 'a8', 'w')).toBe(false);
  });

  test('a bishop x-rays through a pawn sitting directly between it and the target', () => {
    // Bishop g5 — pawn f6 — target e7: the classic pawn-chain x-ray.
    const fen = '4k3/4p3/5p2/6B1/8/8/8/4K3 w - - 0 1';
    expect(hasXrayAttacker(fen, 'e7', 'w')).toBe(true);
  });

  test('a queen follows the same pawn rule as a bishop', () => {
    const fen = '4k3/4p3/5p2/6Q1/8/8/8/4K3 w - - 0 1';
    expect(hasXrayAttacker(fen, 'e7', 'w')).toBe(true);
  });

  /**
   * Pinned as-is: the code counts a pawn adjacent to the SLIDER as transparent
   * (bishop a1 — pawn b2 — target d4), while the doc comment reads "≤1 sq
   * beyond it" as adjacent to the TARGET. The two readings agree on the
   * consecutive case above and diverge here; the current behaviour is
   * recorded until the intended rule is settled.
   */
  test('a pawn adjacent to the slider is transparent however far the target is', () => {
    const fen = '4k3/8/8/8/8/8/1p6/B3K3 w - - 0 1';
    expect(hasXrayAttacker(fen, 'd4', 'w')).toBe(true);
  });

  test('a nonsense target square is false rather than a crash', () => {
    const fen = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
    expect(hasXrayAttacker(fen, 'zz', 'w')).toBe(false);
  });
});

describe('findCCT: capture usefulness', () => {
  test('an equal trade is useful', () => {
    // Rxe5 meets the black rook e8: the smallest recapturer is another rook.
    const result = findCCT('4r1k1/8/8/4r3/8/8/8/4RK2 w - - 0 1');
    const capture = result.captures.find((m) => m.san === 'Rxe5');
    expect(capture?.isUseful).toBe(true);
    expect(capture?.isGoodOption).toBe(true); // even capture clears the heuristic too
  });

  test('a winning capture is useful even when a cheap recapture exists', () => {
    // Bxa5 wins a rook; the b6 pawn can take back, but a bishop for a rook
    // already cleared the winning-capture branch.
    const result = findCCT('4k3/8/1p6/r7/1B6/8/8/4K3 w - - 0 1');
    const capture = result.captures.find((m) => m.san === 'Bxa5');
    expect(capture?.isUseful).toBe(true);
  });

  test('a capture into a strictly cheaper recapture is not useful', () => {
    // Qxe5 takes a pawn the f7 knight recaptures: queen for knight is a loss.
    const result = findCCT('4k3/4pn2/8/4p2Q/8/8/8/4K3 w - - 0 1');
    const capture = result.captures.find((m) => m.san === 'Qxe5');
    expect(capture).toBeDefined(); // landing on the e-file is not check: e7 blocks
    expect(capture?.isUseful).toBe(false);
    expect(capture?.isGoodOption).toBe(false); // 1 captured value < 9 queen value
  });

  test('an undefended capture is useful even at material cost', () => {
    // Qxe5 with nothing to recapture: the pawn is simply won.
    const result = findCCT('6k1/8/8/4p2Q/8/8/8/4K3 w - - 0 1');
    const capture = result.captures.find((m) => m.san === 'Qxe5');
    expect(capture?.isUseful).toBe(true);
    expect(capture?.isGoodOption).toBe(false);
  });

  test('the engine move is useful and the only good option when one is given', () => {
    const result = findCCT('6k1/8/8/4p2Q/8/8/8/4K3 w - - 0 1', 'Qxe5');
    const capture = result.captures.find((m) => m.san === 'Qxe5');
    expect(capture?.isUseful).toBe(true);
    expect(capture?.isGoodOption).toBe(true);
  });
});

describe('findCCT: threats with the usefulness and good-option flags', () => {
  test('a threat move walking into a pawn recapture is not useful', () => {
    // Qd4 attacks the hanging e5 pawn but exd4 wins the queen; the other
    // attacking squares are safe.
    const result = findCCT('4k3/8/8/4p3/8/8/8/3QK3 w - - 0 1');
    const bySan = new Map(result.threats.map((t) => [t.san, t]));
    expect(bySan.get('Qd4')?.threatCategory).toBe('Material');
    expect(bySan.get('Qd4')?.isUseful).toBe(false);
    expect(bySan.get('Qd5')?.isUseful).toBe(true);
    expect(bySan.get('Qd6')?.isUseful).toBe(true);
    expect(bySan.get('Qe2')?.isUseful).toBe(true);
  });

  test('a quiet threat is not a good option by heuristic, but the engine move is', () => {
    const plain = findCCT('4k3/8/8/4p3/8/8/8/3QK3 w - - 0 1');
    expect(plain.threats.find((t) => t.san === 'Qd4')?.isGoodOption).toBe(false);

    const engine = findCCT('4k3/8/8/4p3/8/8/8/3QK3 w - - 0 1', 'Qd4');
    expect(engine.threats.find((t) => t.san === 'Qd4')?.isGoodOption).toBe(true);
    expect(engine.threats.find((t) => t.san === 'Qd5')?.isGoodOption).toBe(false);
  });
});

describe('findCCT: promotions', () => {
  test('handles a position with legal promotions instead of crashing', () => {
    // b7-b8 promotes; chessops keeps the pawn on the backrank unless the move
    // carries a promotion piece, which used to make the mate scanner throw.
    const result = findCCT('3k4/1P6/8/8/8/8/8/4K3 w - - 0 1');
    const checkSans = result.checks.map((m) => m.san);
    expect(checkSans).toContain('b8=Q+');
    expect(checkSans).toContain('b8=R+');
    expect(result.checks.find((m) => m.san === 'b8=Q+')?.uci).toBe('b7b8q');
    expect(result.checks.every((m) => m.isUseful)).toBe(true);
  });

  test('a quiet promotion is scanned without crashing', () => {
    // b8=N gives no check to the h8 king and threatens nothing, so it must
    // pass through the whole threat scanner — which used to throw on any
    // promotion move — while b8=Q+ lands in the checks.
    const result = findCCT('7k/1P6/8/8/8/8/8/4K3 w - - 0 1');
    expect(result.checks.map((m) => m.san)).toContain('b8=Q+');
    expect(result.threats.find((t) => t.san === 'b8=N')).toBeUndefined();
  });
});

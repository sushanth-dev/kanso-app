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
 * blessed. DEBT-005's shallow threat detection is the main one: it counts
 * attackers and defenders rather than searching, so threats that need two moves
 * to see are invisible to it. The tests below record that shape.
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
    // White rook a2 x-rays a8 through the friendly queen a4.
    const fen = '4k3/8/8/8/Q7/8/R7/4K3 w - - 0 1';
    expect(hasXrayAttacker(fen, 'a8', 'w')).toBe(true);
  });

  test('false when the blocker is an enemy piece, which a rook cannot x-ray through', () => {
    const fen = '4k3/8/8/8/q7/8/R7/4K3 w - - 0 1';
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
    expect(result.all[0].type).toBe('Check');
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

  test('DEBT-005: a quiet move attacking an undefended piece is a Material threat', () => {
    // White rook a1 attacks the undefended black pawn a7.
    const fen = '4k3/8/8/8/8/8/p7/R3K3 w - - 0 1';
    const result = findCCT(fen);
    expect(result.threats.some((t) => t.threatCategory === 'Material')).toBe(true);
  });

  test('DEBT-005: a quiet move attacking a defended piece is not a threat', () => {
    // The black pawn a7 is defended by the rook a8, so attacking it is not a
    // winning trade and the static counter sees no threat.
    const fen = 'r3k3/8/8/8/8/8/p7/R3K3 w - - 0 1';
    expect(findCCT(fen).threats).toEqual([]);
  });

  test('DEBT-005: a two-move discovered attack is invisible to the static counter', () => {
    // White rook a1 and bishop c3 line up on black knight a8, defended by the
    // king b8. Moving the bishop (e.g. Bf6) would reveal the rook's attack, but
    // the revealed capture Rxa8 is a losing trade (rook for knight), so the
    // detector counts no winning capture and reports no threat. Pinned as the
    // current shallow behaviour, not endorsed.
    const fen = 'nk6/8/8/8/8/2B5/8/R3K3 w - - 0 1';
    const bishopThreats = findCCT(fen).threats.filter((t) => t.san.startsWith('B'));
    expect(bishopThreats).toEqual([]);
  });

  test('DEBT-005: a quiet king move is flagged Material when a free capture already exists', () => {
    // The rook a1 already attacks the undefended pawn a7, so after any quiet
    // move the null-move probe finds black has a free capture and reports a
    // Material threat, even though the king move created nothing. This is the
    // false-positive side of the same shallow detector.
    const fen = '4k3/8/8/8/8/8/p7/R3K3 w - - 0 1';
    const result = findCCT(fen);
    expect(
      result.threats.some((t) => t.san.startsWith('K') && t.threatCategory === 'Material'),
    ).toBe(true);
  });
});

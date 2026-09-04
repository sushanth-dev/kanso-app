/**
 * The PGN walk, replayed against real games.
 *
 * `walkGame` is the single definition of the ply shape the review surface and
 * the analyser share, so these pin that shape: numbering, colour, the clock
 * chain and the move times chess.js makes derivable, and the one-more-position
 * rule. No database, no engine; the PGNs are inline strings.
 */
import { describe, expect, test } from 'vitest';
import { mergeAdjacentComments, pliesForImport, walkGame } from './walk-pgn.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const SCHOLARS = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. b4 Bxb4 5. c3 Ba5 6. d4 exd4 7. O-O d6 *';
/** Every move carries a clock, so the time chain is derivable from ply 3 on. */
const WITH_CLOCKS =
  '1. e4 { [%clk 0:03:00] } e5 { [%clk 0:02:50] } 2. Nf3 { [%clk 0:02:57] } Nc6 { [%clk 0:02:40] } *';

/** A game that starts from a set position: numbering reads the FEN, not a counter. */
const FROM_FEN = [
  '[Event "Endgame drill"]',
  '[FEN "4k3/8/8/8/8/8/1R6/5B1K w - - 0 40"]',
  '',
  '1. Rb7 Kd8 *',
].join('\n');

describe('walkGame', () => {
  test('produces one ply per half-move and one more position than plies', () => {
    const walk = walkGame(SCHOLARS);
    expect(walk.plies).toHaveLength(14);
    expect(walk.positions).toHaveLength(15);
    expect(walk.positions[0]).toBe(START);
  });

  test('numbers plies from one and move numbers the way a player says them', () => {
    const walk = walkGame(SCHOLARS);
    expect(walk.plies[0]).toMatchObject({ ply: 1, moveNumber: 1, movingColor: 'white' });
    expect(walk.plies[1]).toMatchObject({ ply: 2, moveNumber: 1, movingColor: 'black' });
    expect(walk.plies[2]).toMatchObject({ ply: 3, moveNumber: 2, movingColor: 'white' });
    expect(walk.plies[13]).toMatchObject({ ply: 14, moveNumber: 7, movingColor: 'black' });
  });

  test('carries the SAN, the UCI (LAN) form, and the position each move was played from', () => {
    const walk = walkGame(SCHOLARS);
    expect(walk.plies[0]).toMatchObject({
      san: 'e4',
      uci: 'e2e4',
      fenBefore: START,
    });
    // Ply 6 is 4... Bxb4: a capture from a position white can name.
    expect(walk.plies[7]!.san).toBe('Bxb4');
    expect(walk.plies[7]!.uci).toBe('c5b4');
    // `positions[p]` is the position ply p+1 was played from; the last entry
    // is the finished position.
    expect(walk.positions[7]).toBe(walk.plies[7]!.fenBefore);
    expect(walk.positions[14]).not.toBe(walk.plies[13]!.fenBefore);
  });

  test('a game without clocks leaves the clock columns null', () => {
    const walk = walkGame(SCHOLARS);
    for (const ply of walk.plies) {
      expect(ply.clockMs).toBeNull();
      expect(ply.moveTimeMs).toBeNull();
    }
  });

  test('the clock after each move comes from %clk, and move times subtract the same side', () => {
    const walk = walkGame(WITH_CLOCKS);
    expect(walk.plies.map((p) => p.clockMs)).toEqual([180_000, 170_000, 177_000, 160_000]);
    // The first move of each side has no previous clock; later moves subtract
    // that side's previous remaining time.
    expect(walk.plies.map((p) => p.moveTimeMs)).toEqual([null, null, 3_000, 10_000]);
  });

  test('a game with only one side’s clocks still times that side’s later moves', () => {
    const oneSided = '1. e4 e5 2. Nf3 { [%clk 0:02:57] } *';
    const walk = walkGame(oneSided);
    expect(walk.plies.map((p) => p.clockMs)).toEqual([null, null, 177_000]);
    expect(walk.plies[2]!.moveTimeMs).toBeNull();
  });

  test('a game that starts from a FEN tag numbers and colours from that position', () => {
    const walk = walkGame(FROM_FEN);
    expect(walk.plies[0]).toMatchObject({
      ply: 1,
      moveNumber: 40,
      movingColor: 'white',
      san: 'Rb7',
      uci: 'b2b7',
    });
    expect(walk.plies[1]).toMatchObject({ moveNumber: 40, movingColor: 'black' });
    expect(walk.positions[0]).toBe('4k3/8/8/8/8/8/1R6/5B1K w - - 0 40');
  });

  test('a PGN with tags but no moves is refused, not walked into an empty row set', () => {
    const headerOnly = '[Event "Nothing"]\n[Result "*"]\n\n*';
    expect(() => walkGame(headerOnly)).toThrow(/no moves/);
  });

  test('an illegal game is refused', () => {
    expect(() => walkGame('1. e4 e5 2. Ke2 Qxh1 *')).toThrow();
  });
});

describe('pliesForImport', () => {
  test('attaches the game id and the phase of the position each move was played from', () => {
    const rows = pliesForImport('game-1', SCHOLARS);
    expect(rows).toHaveLength(14);
    for (const row of rows) expect(row.gameId).toBe('game-1');
    expect(rows[0]!.phase).toBe('opening');
    expect(rows[2]!.phase).toBe('opening');
  });

  test('the phase rule runs on the walked position, so a set-piece endgame is one', () => {
    const rows = pliesForImport('game-2', FROM_FEN);
    // Queenless, 8 points of material: an endgame at ply 1.
    expect(rows[0]!.phase).toBe('endgame');
  });

  test('passes the clock fields through untouched', () => {
    const rows = pliesForImport('game-3', WITH_CLOCKS);
    expect(rows[0]).toMatchObject({ clockMs: 180_000, moveTimeMs: null });
    expect(rows[3]).toMatchObject({ clockMs: 160_000, moveTimeMs: 10_000 });
  });
});

describe('mergeAdjacentComments', () => {
  test('two adjacent comments become one comment carrying both texts', () => {
    const merged = mergeAdjacentComments('1. e4 { 0.12/0 } { [%clk 0:03:00] } e5 1-0');
    expect(merged).toBe('1. e4 { 0.12/0   [%clk 0:03:00] } e5 1-0');
    expect(merged.includes('%clk')).toBe(true);
  });

  test('braces with no space between them merge the same way', () => {
    expect(mergeAdjacentComments('1. e4 {a}{b} e5 1-0')).toBe('1. e4 {a b} e5 1-0');
  });

  test('three adjacent comments all collapse into one', () => {
    const merged = mergeAdjacentComments('1. e4 {a} {b} {c} e5 1-0');
    expect(merged).toBe('1. e4 {a b c} e5 1-0');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parsePgn, pgnHash } from './parse-pgn.ts';

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('parsePgn', () => {
  test('parses a clean tournament game with its full tag roster', () => {
    const result = parsePgn(fixture('clean-tournament.pgn'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.games).toHaveLength(1);
    const g = result.games[0]!;
    expect(g.event).toBe('Autumn Open 2025');
    expect(g.site).toBe('Riga LAT');
    expect(g.whiteName).toBe('Kamabathula, Sushanth');
    expect(g.blackName).toBe('Carlsen, Magnus');
    expect(g.whiteElo).toBe(1842);
    expect(g.blackElo).toBe(2830);
    expect(g.eco).toBe('B22');
    expect(g.opening).toBe('Sicilian, Alapin');
    expect(g.timeControl).toBe('5400+30');
    expect(g.result).toBe('1-0');
    expect(g.round).toBe(3);
    expect(g.board).toBeNull();
    expect(g.moveCount).toBeGreaterThan(0);
    expect(g.hasClockData).toBe(false);
    expect(g.playedAt).toEqual(new Date('2025-10-11T00:00:00.000Z'));
  });

  test('imports every game in a multi-game file, each as its own entry', () => {
    const result = parsePgn(fixture('multi-game.pgn'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.games).toHaveLength(3);
    expect(result.games.map((g) => g.result)).toEqual(['1-0', '0-1', '1/2-1/2']);
  });

  test('parses [Round "3.32"] as round 3, board 32', () => {
    const result = parsePgn(fixture('round-board.pgn'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.games[0]!.round).toBe(3);
    expect(result.games[0]!.board).toBe(32);
  });

  test('sets hasClockData true only when the game carries move times', () => {
    const clocked = parsePgn(fixture('with-clock.pgn'));
    const plain = parsePgn(fixture('clean-tournament.pgn'));
    expect(clocked.ok && clocked.games[0]!.hasClockData).toBe(true);
    expect(plain.ok && plain.games[0]!.hasClockData).toBe(false);
  });

  test('stores absent tags as null rather than empty string', () => {
    const result = parsePgn(fixture('sparse-tags.pgn'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const g = result.games[0]!;
    expect(g.event).toBeNull();
    expect(g.whiteName).toBeNull();
    expect(g.whiteElo).toBeNull();
    expect(g.round).toBeNull();
    expect(g.eco).toBeNull();
    expect(g.playedAt).toBeNull();
  });

  test('rejects the whole file when one game is malformed, naming the game', () => {
    const result = parsePgn(fixture('one-malformed.pgn'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.faults).toHaveLength(1);
    expect(result.faults[0]!.index).toBe(1);
    expect(result.faults[0]!.reason).toMatch(/./);
  });

  test('rejects a file that claims more games than the cap', () => {
    const many = Array.from(
      { length: 5 },
      (_, i) => `[Event "G${i}"]\n[Result "1-0"]\n\n1. e4 e5 1-0`,
    ).join('\n\n');
    const result = parsePgn(many, { maxGames: 3 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.faults[0]!.reason).toMatch(/too many games/i);
    expect(result.faults[0]!.code).toBe('too_many_games');
  });

  test('splits and imports a moveless forfeit game as its own entry', () => {
    const result = parsePgn(fixture('with-forfeit.pgn'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.games).toHaveLength(3);
    expect(result.games[1]!.moveCount).toBe(0);
    expect(result.games[1]!.result).toBe('1-0');
  });

  test('parses real lichess exports with eval comments and NAGs in variations', () => {
    // A comment directly after a NAG inside a variation is what chess.js's
    // PEG rejects; this is the pattern real exports produce.
    const pgn = `[Event "Test"]
[Site "Riga LAT"]
[Date "2025.10.11"]
[White "A, B"]
[Black "C, D"]
[Result "1-0"]

1. d4 { 0.17/0 } 1... Nf6 { 0.19/0 } 2. c4 (2. Nf3 { 0.20/0 } 2... e6 $17 { [%cal Gd8g5] }) 2... g6 1-0`;
    const result = parsePgn(pgn);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.games).toHaveLength(1);
    expect(result.games[0]!.moveCount).toBeGreaterThan(0);
    expect(result.games[0]!.event).toBe('Test');
  });
});

describe('pgnHash', () => {
  test('is stable for the same game text', () => {
    const pgn = fixture('clean-tournament.pgn');
    expect(pgnHash(pgn)).toBe(pgnHash(pgn));
  });

  test('differs for two genuinely different games', () => {
    const a = parsePgn(fixture('multi-game.pgn'));
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.games[0]!.pgnHash).not.toBe(a.games[1]!.pgnHash);
  });
});

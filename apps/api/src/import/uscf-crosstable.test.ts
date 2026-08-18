import { describe, expect, test } from 'vitest';
import { parseCrosstable, synthesizeGames } from './uscf-crosstable.ts';

const CROSSTABLE = `rank,name,rating,total,R1,R2
1,"Player, Test",1450,1.5,W-2-1,B-3-0.5
2,"Smith, John",1500,1.0,B-1-0,W-3-1
3,"Doe, Jane",1400,0.5,W-1-0.5,B-2-0`;

describe('parseCrosstable', () => {
  test('parses players and their round cells, ignoring the header', () => {
    const players = parseCrosstable(CROSSTABLE);
    expect(players).toHaveLength(3);
    expect(players[0]).toMatchObject({ name: 'Player, Test', rating: 1450 });
    expect(players[0]!.rounds).toEqual([
      { round: 1, color: 'white', opponent: 2, result: '1-0' },
      { round: 2, color: 'black', opponent: 3, result: '1/2-1/2' },
    ]);
  });
});

describe('synthesizeGames', () => {
  const players = parseCrosstable(CROSSTABLE);

  test('builds header-only games for the matching player', () => {
    const result = synthesizeGames(players, 'Test Player', 'Event', 'tid', 20);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.games).toHaveLength(2);
    expect(result.games[0]!.externalId).toBe('tid:1');
    expect(result.games[0]!.pgn).toContain('[White "Player, Test"]');
    expect(result.games[0]!.pgn).toContain('[Black "Smith, John"]');
    expect(result.games[0]!.pgn).toContain('[Result "1-0"]');
    expect(result.games[1]!.pgn).toContain('[White "Doe, Jane"]');
    expect(result.games[1]!.pgn).toContain('[Black "Player, Test"]');
    expect(result.games[1]!.pgn).toContain('[Result "1/2-1/2"]');
  });

  test('refuses a player with no match', () => {
    expect(synthesizeGames(players, 'Nobody Here', 'Event', 'tid', 20)).toEqual({
      ok: false,
      detail: 'No player named Nobody Here in this tournament.',
    });
  });

  test('refuses a namesake whose surname matches but name does not', () => {
    const withNamesake = parseCrosstable(
      `rank,name,rating,total,R1\n1,"Player, Aarav",1450,1.0,W-2-1`,
    );
    const result = synthesizeGames(withNamesake, 'Test Player', 'Event', 'tid', 20);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain('check the spelling');
  });

  test('refuses two exact matches as ambiguous', () => {
    const duplicate = parseCrosstable(
      `rank,name,rating,total,R1\n1,"Player, Test",1450,0.0,W-2-1\n2,"Test Player",1500,1.0,B-1-0`,
    );
    const result = synthesizeGames(duplicate, 'Test Player', 'Event', 'tid', 20);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain('cannot tell them apart');
  });

  test('caps the games at maxGames', () => {
    const result = synthesizeGames(players, 'Test Player', 'Event', 'tid', 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.games).toHaveLength(1);
  });
});

import { describe, expect, test } from 'vitest';
import { Chess } from 'chess.js';
import { serializeGameToAnnotatedPgn } from './export-pgn.ts';
import type { game, mistake, movePly } from '../db/schema.ts';

type GameRow = typeof game.$inferSelect;
type MovePlyRow = typeof movePly.$inferSelect;
type MistakeRow = typeof mistake.$inferSelect;

function makeGame(overrides: Partial<GameRow> = {}): GameRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    playerId: '00000000-0000-4000-8000-000000000002',
    importJobId: null,
    tournamentId: null,
    stream: 'tournament',
    source: 'pgn_upload',
    externalId: null,
    pgnHash: 'hash123',
    pgn: '1. e4 e5 2. Nf3 Qf6 1-0',
    playerColor: 'white',
    result: '1-0',
    playedAt: new Date('2026-10-15T12:00:00Z'),
    moveCount: 4,
    event: 'National Junior Open',
    site: 'Chicago, IL',
    round: 1,
    board: 3,
    whiteName: 'Maya',
    blackName: 'Alex',
    whiteElo: 1450,
    blackElo: 1420,
    eco: 'C40',
    opening: "King's Pawn Game",
    timeControl: '90+30',
    hasClockData: true,
    analysisStatus: 'complete',
    analyzedAt: new Date('2026-10-15T12:30:00Z'),
    analysisError: null,
    analysisStartedAt: null,
    analysisNodes: null,
    analysisDurationMs: null,
    analysisCostMicros: null,
    importedAt: new Date('2026-10-15T12:00:00Z'),
    ...overrides,
  };
}

function makePlies(): MovePlyRow[] {
  return [
    {
      id: 'p-1',
      gameId: '00000000-0000-4000-8000-000000000001',
      ply: 1,
      san: 'e4',
      uci: 'e2e4',
      fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      phase: 'opening',
      evalCp: 25,
      evalMate: null,
      bestMoveSan: 'e4',
      bestMoveUci: 'e2e4',
      clockMs: 5400000, // 1:30:00
      moveTimeMs: 12000,
    },
    {
      id: 'p-2',
      gameId: '00000000-0000-4000-8000-000000000001',
      ply: 2,
      san: 'e5',
      uci: 'e7e5',
      fenBefore: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
      phase: 'opening',
      evalCp: 20,
      evalMate: null,
      bestMoveSan: 'e5',
      bestMoveUci: 'e7e5',
      clockMs: 5385000, // 1:29:45
      moveTimeMs: 15000,
    },
    {
      id: 'p-3',
      gameId: '00000000-0000-4000-8000-000000000001',
      ply: 3,
      san: 'Nf3',
      uci: 'g1f3',
      fenBefore: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
      phase: 'opening',
      evalCp: 35,
      evalMate: null,
      bestMoveSan: 'Nf3',
      bestMoveUci: 'g1f3',
      clockMs: 5350000,
      moveTimeMs: 50000,
    },
    {
      id: 'p-4',
      gameId: '00000000-0000-4000-8000-000000000001',
      ply: 4,
      san: 'Qf6',
      uci: 'd8f6',
      fenBefore: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
      phase: 'opening',
      evalCp: 180,
      evalMate: null,
      bestMoveSan: 'Nc6',
      bestMoveUci: 'b8c6',
      clockMs: 5300000,
      moveTimeMs: 85000,
    },
  ];
}

function makeMistakes(): MistakeRow[] {
  return [
    {
      id: 'm-1',
      gameId: '00000000-0000-4000-8000-000000000001',
      ply: 4,
      moveNumber: 2,
      movingColor: 'black',
      phase: 'opening',
      fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
      moveSan: 'Qf6',
      bestMoveSan: 'Nc6',
      evalBeforeCp: 35,
      evalBeforeMate: null,
      evalAfterCp: 180,
      evalAfterMate: null,
      judgement: 'mistake',
      cpLoss: 145,
      winProbDrop: 0.18,
      motif: 'hanging_piece',
      crossedResultBoundary: true,
      halfPointsLost: 0.5,
      explanation: null,
      explanationGeneratedAt: null,
      socraticQuestion: null,
      socraticQuestionGeneratedAt: null,
    },
  ];
}

describe('serializeGameToAnnotatedPgn', () => {
  test('serializes seven-tag headers and optional tags', () => {
    const gameRow = makeGame();
    const pgn = serializeGameToAnnotatedPgn(gameRow, makePlies(), makeMistakes());

    expect(pgn).toContain('[Event "National Junior Open"]');
    expect(pgn).toContain('[Site "Chicago, IL"]');
    expect(pgn).toContain('[Date "2026.10.15"]');
    expect(pgn).toContain('[Round "1"]');
    expect(pgn).toContain('[White "Maya"]');
    expect(pgn).toContain('[Black "Alex"]');
    expect(pgn).toContain('[Result "1-0"]');
    expect(pgn).toContain('[ECO "C40"]');
    expect(pgn).toContain('[WhiteElo "1450"]');
    expect(pgn).toContain('[BlackElo "1420"]');
    expect(pgn).toContain('[TimeControl "90+30"]');
  });

  test('formats NAG glyph, eval comment, clock, and mistake diagnosis', () => {
    const pgn = serializeGameToAnnotatedPgn(makeGame(), makePlies(), makeMistakes());

    // NAG for mistake is $2
    expect(pgn).toContain('Qf6 $2');
    // Evaluation comment
    expect(pgn).toContain('[%eval +0.25]');
    expect(pgn).toContain('[%eval +1.80]');
    // Clock comment
    expect(pgn).toContain('[%clk 1:30:00]');
    // Mistake diagnosis
    expect(pgn).toContain('Mistake: Hanging piece. Best was Nc6 (-1.45).');
    // Game result at end
    expect(pgn.trim().endsWith('1-0')).toBe(true);
  });

  test('exported PGN parses cleanly with chess.js', () => {
    const pgn = serializeGameToAnnotatedPgn(makeGame(), makePlies(), makeMistakes());
    const chess = new Chess();
    expect(() => chess.loadPgn(pgn)).not.toThrow();
    expect(chess.history()).toEqual(['e4', 'e5', 'Nf3', 'Qf6']);
  });

  test('falls back to raw PGN if plies are empty (unanalyzed game)', () => {
    const gameRow = makeGame({ pgn: '[Event "Quick"]\n\n1. d4 d5 1/2-1/2' });
    const pgn = serializeGameToAnnotatedPgn(gameRow, [], []);
    expect(pgn).toContain('1. d4 d5 1/2-1/2');
  });
});

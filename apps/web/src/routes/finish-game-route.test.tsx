/**
 * ST-158. The finish-your-own-game session: the stored continuation (the
 * mistake move and the opponent's stored replies) plays itself while the
 * player stays on the rails, an off-rails move asks the endpoint, and the
 * endings close the session without touching the streak. The endpoint client
 * is a stub; the transport is covered by finish-game-api.test.tsx.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Chess } from 'chess.js';
import { finishGameApi, type EngineReply } from '../api/finish-game-api.ts';
import type { GameDetail } from '../api/diagnosis-api.ts';
import { FinishGameScreen } from './finish-game-route.tsx';

const MOVE_PAUSE_MS = 600;

const FEN_BEFORE = 'rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function gameFixture(overrides: Partial<GameDetail> = {}): GameDetail {
  return {
    id: '00000000-0000-4000-8000-0000000000b2',
    stream: 'tournament',
    source: 'pgn_upload',
    playerColor: 'white',
    result: '*',
    playedAt: null,
    event: null,
    round: null,
    board: null,
    whiteName: 'Alice',
    blackName: 'Mina',
    whiteElo: null,
    blackElo: null,
    eco: null,
    opening: null,
    moveCount: 3,
    hasClockData: false,
    analysisStatus: 'complete',
    analyzedAt: null,
    pgn: '1. e4 e5 2. Nf3 Nc6 *',
    plies: [
      {
        ply: 1,
        san: 'e4',
        uci: 'e2e4',
        fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        phase: 'opening',
        evaluation: null,
        bestMoveSan: null,
        bestMoveUci: null,
        clockMs: null,
        moveTimeMs: null,
      },
      {
        ply: 2,
        san: 'e5',
        uci: 'e7e5',
        fenBefore: FEN_BEFORE,
        phase: 'opening',
        evaluation: null,
        bestMoveSan: null,
        bestMoveUci: null,
        clockMs: null,
        moveTimeMs: null,
      },
      {
        ply: 3,
        san: 'Nf3',
        uci: 'g1f3',
        fenBefore: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2',
        phase: 'opening',
        evaluation: null,
        bestMoveSan: null,
        bestMoveUci: null,
        clockMs: null,
        moveTimeMs: null,
      },
      {
        ply: 4,
        san: 'Nc6',
        uci: 'b8c6',
        fenBefore: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
        phase: 'opening',
        evaluation: null,
        bestMoveSan: null,
        bestMoveUci: null,
        clockMs: null,
        moveTimeMs: null,
      },
      {
        ply: 5,
        san: 'Bb5',
        uci: 'f1b5',
        fenBefore: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 3 3',
        phase: 'opening',
        evaluation: null,
        bestMoveSan: null,
        bestMoveUci: null,
        clockMs: null,
        moveTimeMs: null,
      },
    ],
    timeTroubleFromMove: null,
    mistakes: [
      {
        id: 'm-1',
        gameId: '00000000-0000-4000-8000-0000000000b2',
        ply: 3,
        moveNumber: 2,
        movingColor: 'white',
        phase: 'opening',
        fen: FEN_BEFORE,
        moveSan: 'Nf3',
        bestMoveSan: 'Bb5',
        evalBefore: { cp: 30, mate: null },
        evalAfter: { cp: -30, mate: null },
        judgement: 'inaccuracy',
        cpLoss: 60,
        winProbDrop: 0.08,
        motif: null,
        crossedResultBoundary: false,
        halfPointsLost: 0.2,
        explanation: null,
        opponentElo: null,
        severity: 60,
      },
    ],
    ...overrides,
  };
}

const replyFixture: EngineReply = {
  status: 'reply',
  move: { san: 'Nf6', uci: 'g8f6' },
  evaluation: { cp: 10, mate: null },
};

function square(name: string): HTMLElement {
  const el = document.querySelector(`[data-square="${name}"]`);
  if (el === null) throw new Error(`no square ${name}`);
  return el as HTMLElement;
}

function playMove(from: string, to: string): void {
  fireEvent.click(square(from));
  fireEvent.click(square(to));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderScreen(game: GameDetail, mistakePly = 3) {
  return render(<FinishGameScreen game={game} mistakePly={mistakePly} />);
}

describe('FinishGameScreen', () => {
  test('opens before the mistake, at the player turn, with the stop affordance', () => {
    renderScreen(gameFixture());

    expect(screen.getByRole('heading', { name: 'Finish your own game' })).toBeVisible();
    expect(screen.getByText(/you played/)).toHaveTextContent('Nf3');
    expect(screen.getByRole('button', { name: 'Stop the session' })).toBeVisible();
  });

  test('playing the stored mistake move stays on rails and the opponent reply auto-plays', async () => {
    const engineReply = vi.spyOn(finishGameApi, 'engineReply');
    renderScreen(gameFixture());

    // The player's own stored move, played by hand: on the rails, no endpoint.
    playMove('g1', 'f3');
    expect(engineReply).not.toHaveBeenCalled();
    // Nf3 now appears twice: the intro line and the session log.
    expect(screen.getAllByText('Nf3').length).toBe(2);

    // The opponent's stored reply plays itself.
    expect(screen.getByText('The game as it was played continues…')).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MOVE_PAUSE_MS + 50);
    });
    expect(screen.getByText('Nc6')).toBeVisible();
    expect(engineReply).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Stop the session' })).toBeVisible();
  });

  test('an off-rails move asks the endpoint and the reply lands on the board', async () => {
    const engineReply = vi.spyOn(finishGameApi, 'engineReply').mockResolvedValue(replyFixture);
    renderScreen(gameFixture());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MOVE_PAUSE_MS + 50);
    });
    // Off the rails: Bc4 instead of the stored Nf3, a different white move.
    playMove('f1', 'c4');

    expect(screen.getByRole('status', { name: 'Opponent thinking' })).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(engineReply).toHaveBeenCalledOnce();
    expect(engineReply).toHaveBeenCalledWith('00000000-0000-4000-8000-0000000000b2', {
      railPly: 2,
      playerMoves: ['Bc4'],
    });
    // The reply has joined the log, off the rails.
    expect(screen.getByText('Nf6')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Stop the session' })).toBeVisible();
  });

  test('an endpoint failure hands the move back with an alert, and a retry works', async () => {
    const engineReply = vi
      .spyOn(finishGameApi, 'engineReply')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(replyFixture);
    renderScreen(gameFixture());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MOVE_PAUSE_MS + 50);
    });
    playMove('f1', 'c4');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The opponent could not answer. Please try again.',
    );
    expect(screen.getByRole('button', { name: 'Stop the session' })).toBeVisible();

    // The move is back in the player's hands; playing again succeeds.
    playMove('f1', 'c4');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(engineReply).toHaveBeenCalledTimes(2);
    expect(engineReply).toHaveBeenLastCalledWith('00000000-0000-4000-8000-0000000000b2', {
      railPly: 2,
      playerMoves: ['Bc4'],
    });
    expect(screen.getByText('Nf6')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('the stop button closes the session with the real game outcome', () => {
    renderScreen(gameFixture({ result: '0-1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Stop the session' }));

    expect(screen.getByText('The real game: lost.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Back to the game review' })).toBeVisible();
  });

  test('the session continues after the stubbed reply, at the player turn', async () => {
    const engineReply = vi.spyOn(finishGameApi, 'engineReply').mockResolvedValue(replyFixture);
    renderScreen(gameFixture());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MOVE_PAUSE_MS + 50);
    });
    playMove('f1', 'c4');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // The stubbed Nf6 is legal and does not end the game; the player moves on.
    expect(engineReply).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status', { name: 'Opponent thinking' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop the session' })).toBeVisible();
  });

  test('an unknown deep-linked ply lands on the first recorded mistake', () => {
    renderScreen(gameFixture(), 99);

    expect(screen.getByText(/From move/)).toHaveTextContent('Nf3');
  });

  test('a game with no recorded colour asks for the side instead of playing White', async () => {
    renderScreen(gameFixture({ playerColor: null }));

    expect(screen.getByText(/Your side was not recorded/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Back to the game review' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Stop the session' })).toBeNull();
    // No rail auto-plays as if the player were White.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MOVE_PAUSE_MS + 50);
    });
    expect(screen.queryByText('The game as it was played continues…')).toBeNull();
  });

  test('an on-rails non-queen promotion plays the stored piece, not a queen', () => {
    const engineReply = vi.spyOn(finishGameApi, 'engineReply');
    renderScreen(promotionFixture());

    // The player's own stored move 5. b7b8n: clicking the target keeps the
    // session on the rails, and the knight lands on b8 instead of a queen.
    playMove('b7', 'b8');
    expect(engineReply).not.toHaveBeenCalled();
    // Two home knights plus the promoted one on b8; the home queen on d1 stays
    // the only queen, where a queen promotion would put a second on b8.
    expect(screen.getAllByRole('img', { name: 'white knight' })).toHaveLength(3);
    expect(screen.getAllByRole('img', { name: 'white queen' })).toHaveLength(1);
  });
});

/**
 * A game whose recorded continuation ends in a knight promotion. The mistake
 * ply is the player's own `5. b8=N` (uci b7b8n); replaying the stored plies
 * puts a white pawn on b7 with white to move, so the player clicks it and the
 * session must apply the stored knight, not force a queen.
 */
function promotionFixture(): GameDetail {
  const position = new Chess();
  const seeds = [['a4', 'e5', 'a5', 'e4', 'a6', 'e3', 'axb7', 'Na6']];
  const plies: GameDetail['plies'] = [];
  for (const san of seeds[0]!) {
    const fenBefore = position.fen();
    const move = position.move(san);
    plies.push({
      ply: plies.length + 1,
      san,
      uci: move.lan,
      fenBefore,
      phase: 'opening',
      evaluation: null,
      bestMoveSan: null,
      bestMoveUci: null,
      clockMs: null,
      moveTimeMs: null,
    });
  }
  const fenBefore = position.fen();
  const move = position.move({ from: 'b7', to: 'b8', promotion: 'n' });
  plies.push({
    ply: plies.length + 1,
    san: move.san,
    uci: move.lan,
    fenBefore,
    phase: 'opening',
    evaluation: null,
    bestMoveSan: null,
    bestMoveUci: null,
    clockMs: null,
    moveTimeMs: null,
  });
  return gameFixture({
    playerColor: 'white',
    moveCount: 9,
    pgn: '1. a4 e5 2. a5 e4 3. a6 e3 4. axb7 Na6 5. b8=N *',
    plies,
    mistakes: [
      {
        id: 'm-promo',
        gameId: '00000000-0000-4000-8000-0000000000b2',
        ply: 9,
        moveNumber: 5,
        movingColor: 'white',
        phase: 'opening',
        fen: fenBefore,
        moveSan: move.san,
        bestMoveSan: 'b8=Q',
        evalBefore: { cp: 0, mate: null },
        evalAfter: { cp: 0, mate: null },
        judgement: 'inaccuracy',
        cpLoss: 0,
        winProbDrop: 0,
        motif: null,
        crossedResultBoundary: false,
        halfPointsLost: 0,
        explanation: null,
        opponentElo: null,
        severity: 0,
      },
    ],
  });
}

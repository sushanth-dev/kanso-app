import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router';
import { describe, expect, test } from 'vitest';
import type { GameDetail, Mistake } from '../api/diagnosis-api.ts';
import { createAppRouter } from '../router.tsx';
import { GameReviewScreen } from './game-review-route.tsx';

const playerId = '00000000-0000-4000-8000-000000000001';
const gameId = '00000000-0000-4000-8000-000000000002';

const FEN = 'rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 3';

const mistakes: Mistake[] = [
  {
    id: 'm-1',
    gameId,
    ply: 6,
    moveNumber: 3,
    movingColor: 'black',
    phase: 'opening',
    fen: FEN,
    moveSan: 'Qf6',
    bestMoveSan: 'Nc6',
    evalBefore: { cp: 30, mate: null },
    evalAfter: { cp: -200, mate: null },
    judgement: 'blunder',
    cpLoss: 230,
    winProbDrop: 0.4,
    motif: 'hanging_piece',
    crossedResultBoundary: true,
    halfPointsLost: 1,
    explanation: null,
  },
  {
    id: 'm-2',
    gameId,
    ply: 8,
    moveNumber: 4,
    movingColor: 'black',
    phase: 'opening',
    fen: FEN,
    moveSan: 'Qxf3',
    bestMoveSan: 'd6',
    evalBefore: { cp: -180, mate: null },
    evalAfter: { cp: -600, mate: null },
    judgement: 'blunder',
    cpLoss: 420,
    winProbDrop: 0.6,
    motif: 'hanging_piece',
    crossedResultBoundary: true,
    halfPointsLost: 1,
    explanation: null,
  },
];

function gameFixture(overrides: Partial<GameDetail> = {}): GameDetail {
  return {
    id: gameId,
    stream: 'tournament',
    source: 'pgn_upload',
    playerColor: 'black',
    result: '0-1',
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
    moveCount: 10,
    hasClockData: false,
    analysisStatus: 'complete',
    analyzedAt: null,
    pgn: '1. e4 e5 2. Nf3 Qf6 3. Nc3 Qxf3 0-1',
    plies: [
      {
        ply: 6,
        san: 'Qf6',
        uci: 'd8f6',
        fenBefore: FEN,
        phase: 'opening',
        evaluation: { cp: 30, mate: null },
        bestMoveSan: 'Nc6',
        bestMoveUci: 'b8c6',
        clockMs: null,
        moveTimeMs: null,
      },
      {
        ply: 8,
        san: 'Qxf3',
        uci: 'f6f3',
        fenBefore: FEN,
        phase: 'opening',
        evaluation: { cp: -200, mate: null },
        bestMoveSan: 'd6',
        bestMoveUci: 'd7d6',
        clockMs: null,
        moveTimeMs: null,
      },
    ],
    mistakes,
    ...overrides,
  };
}

function renderScreen(game: GameDetail) {
  const user = userEvent.setup();
  const history = createMemoryHistory();
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <GameReviewScreen game={game} playerId={playerId} />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
  return { user };
}

describe('GameReviewScreen', () => {
  test('shows the first mistake position by default', () => {
    renderScreen(gameFixture());
    expect(screen.getByText(/you played/)).toHaveTextContent('Qf6');
    expect(screen.getByText(/best was/)).toHaveTextContent('Nc6');
    expect(screen.getByText('vs Alice')).toBeInTheDocument();
  });

  test('lists every mistake and switches position on selection', async () => {
    const { user } = renderScreen(gameFixture());
    expect(screen.getAllByRole('button').length).toBe(2);
    await user.click(screen.getByRole('button', { name: /Qxf3/ }));
    expect(screen.getByText(/you played/)).toHaveTextContent('Qxf3');
    expect(screen.getByText(/best was/)).toHaveTextContent('d6');
  });

  test('says honestly when the game has no recorded mistakes', () => {
    renderScreen(gameFixture({ mistakes: [], plies: [] }));
    expect(screen.getByText('No recorded mistakes in this game.')).toBeInTheDocument();
  });
  test('shows each mistake cost in the list', () => {
    renderScreen(gameFixture());
    expect(screen.getByText('-2.3')).toBeInTheDocument();
    expect(screen.getByText('-4.2')).toBeInTheDocument();
  });

  test("labels the evaluation as White's advantage", () => {
    renderScreen(gameFixture());
    expect(screen.getByText(/White's advantage/)).toBeInTheDocument();
  });

  test("glosses the result from the player's side", () => {
    renderScreen(gameFixture());
    expect(screen.getByText('You won.')).toBeInTheDocument();
    renderScreen(gameFixture({ playerColor: 'white', result: '0-1' }));
    expect(screen.getByText('You lost.')).toBeInTheDocument();
  });

  test('reconstructs the position in the board label', () => {
    renderScreen(gameFixture());
    expect(screen.getByRole('img', { name: /white king e1/ })).toBeInTheDocument();
  });
});

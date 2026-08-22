import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { diagnosisApi, type CctScan, type GameDetail, type Mistake } from '../api/diagnosis-api.ts';
import { createAppRouter } from '../router.tsx';
import { GameReviewScreen } from './game-review-route.tsx';

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
        ply: 5,
        san: 'Nf3',
        uci: 'g1f3',
        fenBefore: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2',
        phase: 'opening',
        evaluation: { cp: 20, mate: null },
        bestMoveSan: 'Nf3',
        bestMoveUci: 'g1f3',
        clockMs: null,
        moveTimeMs: null,
      },
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
        ply: 7,
        san: 'Nc3',
        uci: 'b1c3',
        fenBefore: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3',
        phase: 'opening',
        evaluation: { cp: -200, mate: null },
        bestMoveSan: 'Nc3',
        bestMoveUci: 'b1c3',
        clockMs: null,
        moveTimeMs: null,
      },
      {
        ply: 8,
        san: 'Qxf3',
        uci: 'f6f3',
        fenBefore: FEN,
        phase: 'opening',
        evaluation: { cp: -180, mate: null },
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

const emptyScan: CctScan = { mistakeId: 'm-1', checks: [], captures: [], threats: [] };

beforeEach(() => {
  vi.spyOn(diagnosisApi, 'getCctScan').mockResolvedValue(emptyScan);
  vi.spyOn(diagnosisApi, 'getExplanation').mockResolvedValue({
    mistakeId: 'm-1',
    text: 'Qf6 hangs the queen to Nc6; the knight forks it with the rook.',
    generatedAt: '2026-08-22T00:00:00.000Z',
  });
  vi.spyOn(diagnosisApi, 'getSocraticQuestion').mockResolvedValue({
    mistakeId: 'm-1',
    question: 'What does Nc6 attack that Qf6 ignored?',
    generatedAt: '2026-08-22T00:00:00.000Z',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderScreen(game: GameDetail) {
  const user = userEvent.setup();
  const history = createMemoryHistory();
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <GameReviewScreen game={game} />
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

  test('lists every move in the notation panel and switches position on selection', async () => {
    const { user } = renderScreen(gameFixture());
    await user.click(screen.getByRole('button', { name: /Qxf3/ }));
    expect(screen.getByText(/you played/)).toHaveTextContent('Qxf3');
    expect(screen.getByText(/best was/)).toHaveTextContent('d6');
  });

  test('says honestly when the game has no recorded moves', () => {
    renderScreen(gameFixture({ mistakes: [], plies: [] }));
    expect(screen.getByText('No recorded moves in this game.')).toBeInTheDocument();
  });

  test('a game with plies but no mistakes is still steppable', () => {
    renderScreen(gameFixture({ mistakes: [] }));
    expect(screen.getByText(/you played/)).toHaveTextContent('Nf3');
    expect(screen.getByRole('button', { name: 'Next move' })).toBeEnabled();
  });

  test('shows the plain move line on a non-mistake ply', async () => {
    const { user } = renderScreen(gameFixture());
    await user.click(screen.getByRole('button', { name: /Nc3/ }));
    expect(screen.getByText(/you played/)).toHaveTextContent('Nc3');
    expect(screen.queryByText(/best was/)).not.toBeInTheDocument();
  });

  test('shows the mistake glyph in the notation panel', () => {
    renderScreen(gameFixture());
    const blunder = screen.getByRole('button', { name: /Qf6/ });
    expect(blunder).toHaveTextContent('??');
  });

  test('Previous is disabled on the first move, Next on the last', async () => {
    const { user } = renderScreen(gameFixture());
    await user.click(screen.getByRole('button', { name: /^Nf3$/ }));
    expect(screen.getByRole('button', { name: 'Previous move' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Qxf3/ }));
    expect(screen.getByRole('button', { name: 'Next move' })).toBeDisabled();
  });

  test('Next and Previous buttons step through every ply, not just mistakes', async () => {
    const { user } = renderScreen(gameFixture());
    await user.click(screen.getByRole('button', { name: /^Nf3$/ }));
    await user.click(screen.getByRole('button', { name: 'Next move' }));
    expect(screen.getByText(/you played/)).toHaveTextContent('Qf6');
  });

  test('ArrowRight and ArrowLeft step through the game, and no-op at the boundaries', async () => {
    const { user } = renderScreen(gameFixture());
    await user.click(screen.getByRole('button', { name: /^Nf3$/ }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByText(/you played/)).toHaveTextContent('Qf6');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByText(/you played/)).toHaveTextContent('Nf3');
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

  test('shows the CCT scan for the selected mistake, best move highlighted', async () => {
    vi.spyOn(diagnosisApi, 'getCctScan').mockResolvedValue({
      mistakeId: 'm-1',
      checks: [{ san: 'Qd1+', uci: 'a1d1', type: 'Check', isGoodOption: true, isUseful: true }],
      captures: [
        { san: 'Qxb2', uci: 'a1b2', type: 'Capture', isGoodOption: false, isUseful: true },
      ],
      threats: [],
    });
    renderScreen(gameFixture());
    expect(await screen.findByText('Qd1+')).toBeInTheDocument();
    expect(screen.getByText('Qxb2')).toBeInTheDocument();
  });

  test('says honestly when the scan has no checks, captures or threats', async () => {
    renderScreen(gameFixture());
    await waitFor(() =>
      expect(
        screen.getByText('No checks, captures or threats at this position.'),
      ).toBeInTheDocument(),
    );
  });

  test('shows the AI explanation and Socratic question for the mistake', async () => {
    renderScreen(gameFixture());
    expect(await screen.findByText(/Qf6 hangs the queen to Nc6/)).toBeInTheDocument();
    expect(screen.getByText('What does Nc6 attack that Qf6 ignored?')).toBeInTheDocument();
  });

  test('says honestly when the explanation could not be loaded', async () => {
    vi.spyOn(diagnosisApi, 'getExplanation').mockRejectedValue(new Error('502'));
    renderScreen(gameFixture());
    expect(await screen.findByText('The explanation could not be loaded.')).toBeInTheDocument();
  });
});

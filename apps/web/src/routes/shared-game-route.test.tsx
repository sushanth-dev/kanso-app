import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError } from '../api/account-api.ts';
import { sharedGameApi, type SharedGame } from '../api/game-share-api.ts';
import { createAppRouter } from '../router.tsx';
import { SharedGameScreen } from './shared-game-route.tsx';

const FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 3';

function gameFixture(overrides: Partial<SharedGame> = {}): SharedGame {
  return {
    whiteName: 'Magness C',
    blackName: 'Sushanth Kamabathula',
    result: '0-1',
    playerColor: 'black',
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
    mistakes: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        gameId: '66666666-6666-4666-8666-666666666666',
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
        crossedResultBoundary: false,
        halfPointsLost: 0.5,
        opponentElo: null,
        severity: 230,
      },
    ],
    ...overrides,
  };
}

function renderRoute(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});
describe('SharedGameScreen', () => {
  test('renders the game: names, result, gloss, mistake cost, and the move list', () => {
    render(<SharedGameScreen shared={gameFixture()} />);

    expect(screen.getByRole('heading', { name: 'Magness C vs Sushanth Kamabathula' }));
    // ST-138: the result renders twice - an sr-only value with the animated
    // figure aria-hidden on top - so the query is plural by design.
    expect(screen.getAllByText('0-1')).toHaveLength(2);
    expect(screen.getByText('The player won.')).toBeInTheDocument();
    expect(screen.getByText('-2.3 pawns')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Moves' })).toBeInTheDocument();
    expect(screen.getByText('Hung a piece')).toBeInTheDocument();
  });

  test('opens at the first mistake, with the board label reconstructing the position', () => {
    render(<SharedGameScreen shared={gameFixture()} />);

    expect(
      screen.getByRole('img', { name: /Position before move 3, black to move/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Move 1 of 1')).toBeInTheDocument();
  });

  test('steps through the game from the transport, which is viewing rather than mutation', async () => {
    const user = userEvent.setup();
    render(<SharedGameScreen shared={gameFixture()} />);

    await user.click(screen.getByRole('button', { name: 'Next move' }));

    expect(screen.getByRole('img', { name: /Position before move 4, black to move/ }));
  });

  test('sets the document title to the players and restores it on unmount', () => {
    const { unmount } = render(<SharedGameScreen shared={gameFixture()} />);

    expect(document.title).toBe('Magness C vs Sushanth Kamabathula · Kanso Chess');
    unmount();
    expect(document.title).toBe('Kanso Chess');
  });

  test('never renders the coach cards, the drill, or any account affordance', () => {
    render(<SharedGameScreen shared={gameFixture()} />);

    expect(screen.queryByText("Coach's take")).not.toBeInTheDocument();
    expect(screen.queryByText(/Socratic/i)).not.toBeInTheDocument();
    expect(screen.queryByText('CCT scan')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Drill this pattern' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete game' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to games' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I was White' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /games/ })).not.toBeInTheDocument();
  });
});

describe('SharedGameRoute', () => {
  test('shows the one indistinguishable unavailable page for a dead link', async () => {
    vi.spyOn(sharedGameApi, 'getShared').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No such shared game.'),
    );

    renderRoute('/shared/games/dead');

    expect(
      await screen.findByRole('heading', { name: 'This link is no longer available.' }),
    ).toBeInTheDocument();
  });

  test('renders the unreachable page for a network failure, with a retry', async () => {
    const user = userEvent.setup();
    const getShared = vi
      .spyOn(sharedGameApi, 'getShared')
      .mockRejectedValue(new TypeError('Failed to fetch'));

    renderRoute('/shared/games/dead');

    expect(
      await screen.findByRole('heading', { name: 'This page could not be reached.' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('This link is no longer available.')).not.toBeInTheDocument();

    getShared.mockResolvedValue(gameFixture());
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByRole('heading', { name: 'Magness C vs Sushanth Kamabathula' }),
    ).toBeInTheDocument();
  });
});

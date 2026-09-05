import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider, RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { accountApi, ApiRequestError, type Me } from '../api/account-api.ts';
import {
  diagnosisApi,
  type CctScan,
  type Explanation,
  type GameDetail,
  type Mistake,
  type MovePly,
  type SocraticQuestion,
} from '../api/diagnosis-api.ts';
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
    timeTroubleFromMove: null,
    mistakes,
    ...overrides,
  };
}

/** Eight plies whose white plies carry the stored clock readings 5:00→1:30. */
function clockedPlies(): MovePly[] {
  const sans = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'bxc6'];
  const whiteClocks = [300_000, 240_000, 150_000, 90_000];
  return sans.map((san, index) => {
    const ply = index + 1;
    const isWhite = ply % 2 === 1;
    return {
      ply,
      san,
      uci: 'g1f3',
      fenBefore: isWhite ? START_W : START_B,
      phase: 'opening',
      evaluation: null,
      bestMoveSan: null,
      bestMoveUci: null,
      clockMs: isWhite ? whiteClocks[(ply - 1) / 2]! : 295_000,
      moveTimeMs: null,
    };
  });
}

const START_W = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const START_B = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';

const meFixture: Me = {
  userId: 'user-1',
  email: 'player@example.com',
  name: 'Player',
  tier: 'beginner',
  player: {
    id: '00000000-0000-4000-8000-000000000001',
    displayName: 'Mina',
    birthYear: 2013,
    fideId: null,
    fideRating: null,
    uscfId: null,
    uscfRating: null,
    chesscomUsername: null,
    lichessUsername: null,
    chesscomRating: null,
    lichessRating: null,
    currentStreak: 0,
    xp: 0,
    level: 1,
    createdAt: '2026-08-14T00:00:00.000Z',
  },
};

const emptyScan: CctScan = { mistakeId: 'm-1', checks: [], captures: [], threats: [] };

beforeEach(() => {
  vi.spyOn(diagnosisApi, 'getCctScan').mockResolvedValue(emptyScan);
  vi.spyOn(diagnosisApi, 'getExplanation').mockResolvedValue({
    mistakeId: 'm-1',
    text: 'Qf6 hangs the queen to Nc6; the knight forks it with the rook.',
    generatedAt: '2026-08-22T00:00:00.000Z',
    remaining: 48,
    monthlyCap: 50,
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

function renderScreen(game: GameDetail, targetPly?: number) {
  const user = userEvent.setup();
  const history = createMemoryHistory();
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <GameReviewScreen game={game} targetPly={targetPly} />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
  return { user, container: view.container };
}

describe('GameReviewScreen', () => {
  test('shows the first mistake position by default', () => {
    renderScreen(gameFixture());
    expect(screen.getByText(/you played/)).toHaveTextContent('Qf6');
    expect(screen.getByText(/best was/)).toHaveTextContent('Nc6');
    expect(screen.getByText('Alice vs Mina')).toBeInTheDocument();
  });

  test('ST-100: opens the deep-linked ply when the report evidence sent one', () => {
    renderScreen(gameFixture(), 8);
    expect(screen.getByText(/you played/)).toHaveTextContent('Qxf3');
    expect(screen.getByText(/best was/)).toHaveTextContent('d6');
  });

  test('ST-100: an unknown deep-linked ply falls back to the first mistake', () => {
    renderScreen(gameFixture(), 999);
    expect(screen.getByText(/you played/)).toHaveTextContent('Qf6');
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
    expect(screen.getByText(/played/)).toHaveTextContent('Nf3');
    expect(screen.getByRole('button', { name: 'Next move' })).toBeEnabled();
  });

  test('shows the plain move line on a non-mistake ply', async () => {
    const { user } = renderScreen(gameFixture());
    await user.click(screen.getByRole('button', { name: /Nc3/ }));
    expect(screen.getByText(/played/)).toHaveTextContent('Nc3');
    expect(screen.queryByText(/best was/)).not.toBeInTheDocument();
  });

  test('attributes a move to the player or the opponent by colour', async () => {
    const { user } = renderScreen(gameFixture());
    // The board opens on the first mistake (ply 6, Qf6), Black's move: the player's own.
    expect(screen.getByText(/you played/)).toHaveTextContent('Qf6');
    // Step to ply 7 (Nc3), White's move: the opponent's (Alice).
    await user.click(screen.getByRole('button', { name: /Nc3/ }));
    expect(screen.getByText(/Alice played/)).toHaveTextContent('Nc3');
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

  test('ArrowRight and ArrowLeft step through the game', async () => {
    const { user } = renderScreen(gameFixture());
    await user.click(screen.getByRole('button', { name: /^Nf3$/ }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByText(/you played/)).toHaveTextContent('Qf6');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByText(/you played/)).toHaveTextContent('Nf3');
  });

  test('ArrowDown jumps to the last move and ArrowUp to the first', async () => {
    const { user } = renderScreen(gameFixture());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByText(/played/)).toHaveTextContent('Qxf3');
    await user.keyboard('{ArrowUp}');
    expect(screen.getByText(/played/)).toHaveTextContent('Nf3');
  });

  test('labels the evaluation as the advantage', () => {
    renderScreen(gameFixture());
    expect(screen.getByText(/Advantage:/)).toBeInTheDocument();
  });

  test('shows a neutral circle and mover names when the player colour is unknown', () => {
    renderScreen(gameFixture({ playerColor: null }));
    expect(
      screen.getByRole('img', { name: 'Your colour is not set for this game' }),
    ).toBeInTheDocument();
    // The board opens on the first mistake (ply 6, Qf6), Black's move: Mina.
    expect(screen.getByText(/Mina played/)).toHaveTextContent('Qf6');
  });

  test('shows the move count in full moves, not plies', () => {
    renderScreen(gameFixture());
    expect(screen.getByText('Move 1 of 2')).toBeInTheDocument();
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

  test('says honestly when the explanation could not be loaded', async () => {
    vi.spyOn(diagnosisApi, 'getExplanation').mockRejectedValue(new Error('502'));
    renderScreen(gameFixture());
    expect(await screen.findByText('The explanation could not be loaded.')).toBeInTheDocument();
  });

  test('deletes the game from the review page after confirmation', async () => {
    const { user } = renderScreen(gameFixture());
    const deleteGame = vi.spyOn(diagnosisApi, 'deleteGame').mockResolvedValue(undefined);

    await user.click(screen.getByRole('button', { name: 'Delete game' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this game?' });
    expect(dialog).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteGame).toHaveBeenCalledWith(gameId));
  });

  test('offers to set the player colour when it is undecided', async () => {
    const { user } = renderScreen(gameFixture({ playerColor: null }));
    const setGameColor = vi
      .spyOn(diagnosisApi, 'setGameColor')
      .mockResolvedValue(gameFixture({ playerColor: 'white' }));

    expect(
      screen.getByText('Your side was not recorded for this game. Which colour were you?'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'I was White' }));
    await waitFor(() => expect(setGameColor).toHaveBeenCalledWith(gameId, 'white'));
  });

  test('does not offer to set the colour when it is already known', () => {
    renderScreen(gameFixture());
    expect(
      screen.queryByText('Your side was not recorded for this game. Which colour were you?'),
    ).not.toBeInTheDocument();
  });

  test('says honestly when the scan itself fails', async () => {
    vi.spyOn(diagnosisApi, 'getCctScan').mockRejectedValue(new Error('502'));
    renderScreen(gameFixture());
    expect(await screen.findByText('The scan could not be loaded.')).toBeInTheDocument();
  });

  test('groups the scan into checks and threats, skipping empty groups', async () => {
    vi.spyOn(diagnosisApi, 'getCctScan').mockResolvedValue({
      mistakeId: 'm-1',
      checks: [{ san: 'Qd1+', uci: 'a1d1', type: 'Check', isGoodOption: true, isUseful: true }],
      captures: [],
      threats: [{ san: 'Qxa7', uci: 'a1a7', type: 'Threat', isGoodOption: false, isUseful: true }],
    });
    renderScreen(gameFixture());
    expect(await screen.findByText('Checks')).toBeInTheDocument();
    expect(screen.getByText('Threats')).toBeInTheDocument();
    expect(screen.getByText('Qd1+')).toBeInTheDocument();
    expect(screen.getByText('Qxa7')).toBeInTheDocument();
    expect(screen.queryByText('Captures')).not.toBeInTheDocument();
  });

  test('renders the monthly budget prompt when the explanation is paywalled', async () => {
    vi.spyOn(diagnosisApi, 'getExplanation').mockRejectedValue(
      new ApiRequestError(402, 'upgrade_required', undefined, 'Upgrade required.'),
    );
    renderScreen(gameFixture());
    expect(
      await screen.findByRole('heading', { name: "You have used this month's coach explanations" }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/upgrade');
  });

  test('shows the monthly coach budget counter on the card', async () => {
    renderScreen(gameFixture());
    expect(await screen.findByText('48 of 50 left this month')).toBeInTheDocument();
  });

  test('shows no counter on an unlimited plan', async () => {
    vi.spyOn(diagnosisApi, 'getExplanation').mockResolvedValue({
      mistakeId: 'm-1',
      text: 'Qf6 hangs the queen to Nc6; the knight forks it with the rook.',
      generatedAt: '2026-08-22T00:00:00.000Z',
      remaining: null,
      monthlyCap: null,
    });
    renderScreen(gameFixture());
    expect(await screen.findByText(/hangs the queen/)).toBeInTheDocument();
    expect(screen.queryByText(/left this month/)).not.toBeInTheDocument();
  });

  test('holds the working lines while the coach texts are being written', async () => {
    vi.spyOn(diagnosisApi, 'getExplanation').mockReturnValue(
      Promise.withResolvers<Explanation>().promise,
    );
    vi.spyOn(diagnosisApi, 'getSocraticQuestion').mockReturnValue(
      Promise.withResolvers<SocraticQuestion>().promise,
    );
    renderScreen(gameFixture());
    expect(await screen.findByText('Working out what happened here…')).toBeInTheDocument();
    expect(screen.getByText('Thinking of a question to ask you…')).toBeInTheDocument();
  });

  test('drops the question line when the Socratic question fails', async () => {
    vi.spyOn(diagnosisApi, 'getSocraticQuestion').mockRejectedValue(new Error('502'));
    renderScreen(gameFixture());
    expect(await screen.findByText(/hangs the queen/)).toBeInTheDocument();
    expect(screen.queryByText('Thinking of a question to ask you…')).not.toBeInTheDocument();
  });

  test('falls back to generic names when the PGN omits the players', async () => {
    const { user } = renderScreen(gameFixture({ whiteName: null, blackName: null }));
    expect(screen.getByText('Unknown vs Unknown')).toBeInTheDocument();
    // The opponent's ply names the generic side: the PGN carried no name.
    await user.click(screen.getByRole('button', { name: /Nc3/ }));
    expect(screen.getByText(/played/)).toHaveTextContent('White played Nc3');
  });

  test('glosses a draw from either side', () => {
    renderScreen(gameFixture({ result: '1/2-1/2' }));
    expect(screen.getByText('You drew.')).toBeInTheDocument();
  });

  test('glosses nothing when the game is unfinished or the side is unset', () => {
    renderScreen(gameFixture({ result: '*' }));
    expect(screen.queryByText(/^You (won|lost|drew)\.$/)).not.toBeInTheDocument();
    renderScreen(gameFixture({ playerColor: null, result: '1-0' }));
    expect(screen.queryByText(/^You (won|lost|drew)\.$/)).not.toBeInTheDocument();
  });

  test('clamps the arrow keys at the ends of the game', async () => {
    const { user } = renderScreen(gameFixture());
    await user.keyboard('{ArrowDown}{ArrowRight}');
    expect(screen.getByText(/played/)).toHaveTextContent('Qxf3');
    await user.keyboard('{ArrowUp}{ArrowLeft}');
    expect(screen.getByText(/played/)).toHaveTextContent('Nf3');
  });

  test('shows the player-colour dot for the player\u2019s side', () => {
    renderScreen(gameFixture({ playerColor: 'white', result: '1-0' }));
    expect(screen.getByRole('img', { name: 'You play white' })).toBeInTheDocument();
  });

  test('ST-121: draws the player\u2019s clock curve and marks the report\u2019s onset', () => {
    renderScreen(
      gameFixture({ playerColor: 'white', plies: clockedPlies(), timeTroubleFromMove: 2 }),
    );
    const chart = screen.getByRole('img', { name: /remaining clock/i });
    // Only the player's own readings set the curve: white's first and last clocks.
    expect(chart).toHaveAccessibleName(/from 5:00 to 1:30/);
    // The onset marker carries a label, never hue alone.
    expect(screen.getByText('Time trouble \u00b7 move 2')).toBeInTheDocument();
  });

  test('ST-121: an onset past the game\u2019s last move marks nothing', () => {
    renderScreen(
      gameFixture({ playerColor: 'white', plies: clockedPlies(), timeTroubleFromMove: 9 }),
    );
    expect(screen.getByRole('img', { name: /remaining clock/i })).toHaveAccessibleName(
      /^Your remaining clock after each of your moves, from 5:00 to 1:30\.$/,
    );
    expect(screen.queryByText(/Time trouble/)).not.toBeInTheDocument();
  });

  test('ST-121: a game whose player has no clock readings names no_clock_data', () => {
    renderScreen(gameFixture());
    expect(
      screen.getByText('No clock data on this game, so there is no clock curve.'),
    ).toBeInTheDocument();
  });

  test('ST-121: a single clock reading is not_enough_evidence', () => {
    const plies = clockedPlies().map((ply) => (ply.ply === 1 ? ply : { ...ply, clockMs: null }));
    renderScreen(gameFixture({ playerColor: 'white', plies }));
    expect(
      screen.getByText('Too few clock readings on your moves to draw a clock curve.'),
    ).toBeInTheDocument();
  });

  test('ST-121: with the colour unset no clock is the player\u2019s yet', () => {
    renderScreen(gameFixture({ playerColor: null, plies: clockedPlies() }));
    expect(screen.getByText(/Set your colour above/)).toBeInTheDocument();
  });
});

describe('GameReviewScreen drill entry', () => {
  test('ST-106: the mistake card offers the group puzzle drill', () => {
    renderScreen(gameFixture());
    const link = screen.getByRole('link', { name: 'Drill this pattern' });
    expect(link).toHaveAttribute(
      'href',
      `/practice?kind=motif&group=hanging_piece&label=${encodeURIComponent('Hung a piece')}&stream=tournament`,
    );
  });

  test('ST-106: a mistake with no motif and no phase offers no drill', () => {
    renderScreen(gameFixture({ mistakes: [{ ...mistakes[0]!, motif: null, phase: null }] }));
    expect(screen.queryByRole('link', { name: 'Drill this pattern' })).not.toBeInTheDocument();
  });

  test('ST-106: a phase mistake drills the game phase', () => {
    renderScreen(gameFixture({ mistakes: [{ ...mistakes[0]!, motif: null, phase: 'endgame' }] }));
    expect(screen.getByRole('link', { name: 'Drill this pattern' })).toHaveAttribute(
      'href',
      `/practice?kind=phase&group=endgame&label=${encodeURIComponent('Endgame')}&stream=tournament`,
    );
  });

  test('names an unrecognised motif as it arrived, never a blank label', () => {
    renderScreen(gameFixture({ mistakes: [{ ...mistakes[0]!, motif: 'back_rank_tiredness' }] }));
    expect(screen.getByText('back_rank_tiredness')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Drill this pattern' })).toHaveAttribute(
      'href',
      expect.stringContaining('group=back_rank_tiredness'),
    );
  });
});

describe('GameReviewRoute', () => {
  // The account layout's beforeLoad resolves the signed-in user first.
  beforeEach(() => {
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderRoute(path = `/games/${gameId}`) {
    const history = createMemoryHistory({ initialEntries: [path] });
    const queryClient = new QueryClient();
    const router = createAppRouter({ history, queryClient });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    return { router };
  }

  test('shows the analysing loader while the game is on the engine, then the review', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getGame = vi
      .spyOn(diagnosisApi, 'getGame')
      .mockResolvedValueOnce(gameFixture({ analysisStatus: 'analyzing' }))
      .mockResolvedValue(gameFixture({ analysisStatus: 'complete' }));

    renderRoute();

    expect(await screen.findByRole('status', { name: 'Analysing game' })).toBeVisible();

    await vi.advanceTimersByTimeAsync(5000);

    await waitFor(() => {
      expect(screen.queryByRole('status', { name: 'Analysing game' })).toBeNull();
    });
    expect(getGame.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('shows no analysing loader for a completed game', async () => {
    vi.spyOn(diagnosisApi, 'getGame').mockResolvedValue(gameFixture());

    renderRoute();

    expect(await screen.findByText('Alice vs Mina')).toBeVisible();
    expect(screen.queryByRole('status', { name: 'Analysing game' })).toBeNull();
  });

  test('waits for the player on a colourless game instead of the loader', async () => {
    vi.spyOn(diagnosisApi, 'getGame').mockResolvedValue(
      gameFixture({ playerColor: null, analysisStatus: 'pending' }),
    );

    renderRoute();

    expect(
      await screen.findByText('Your side was not recorded for this game. Which colour were you?'),
    ).toBeVisible();
    expect(screen.queryByRole('status', { name: 'Analysing game' })).toBeNull();
  });
  test('shows the honest error state when the game cannot be loaded', async () => {
    vi.spyOn(diagnosisApi, 'getGame').mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Boom.'),
    );
    renderRoute();
    expect(
      await screen.findByRole('heading', { name: 'This game could not be loaded' }),
    ).toBeVisible();
  });

  test('ST-100: the ply rides the URL onto the board', async () => {
    vi.spyOn(diagnosisApi, 'getGame').mockResolvedValue(gameFixture());
    renderRoute(`/games/${gameId}?ply=8`);
    expect(await screen.findByText(/you played/)).toHaveTextContent('Qxf3');
  });

  test('returns to the games list after a confirmed delete', async () => {
    const user = userEvent.setup();
    vi.spyOn(diagnosisApi, 'getGame').mockResolvedValue(gameFixture());
    vi.spyOn(diagnosisApi, 'deleteGame').mockResolvedValue(undefined);
    vi.spyOn(diagnosisApi, 'listGames').mockResolvedValue({
      games: [],
      total: 0,
      page: 1,
      limit: 100,
    });
    const { router } = renderRoute();
    await user.click(await screen.findByRole('button', { name: 'Delete game' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/games');
    });
  });

  test('stays on the review with an error line when the delete fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(diagnosisApi, 'getGame').mockResolvedValue(gameFixture());
    vi.spyOn(diagnosisApi, 'deleteGame').mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Boom.'),
    );
    const { router } = renderRoute();
    await user.click(await screen.findByRole('button', { name: 'Delete game' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(
      await screen.findByText('The game could not be deleted. Please try again.'),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe(`/games/${gameId}`);
  });

  test('saves the colour, refetches the game, and orients to the player side', async () => {
    const user = userEvent.setup();
    vi.spyOn(diagnosisApi, 'getGame')
      .mockResolvedValueOnce(gameFixture({ playerColor: null, analysisStatus: 'complete' }))
      .mockResolvedValue(gameFixture());
    const setGameColor = vi.spyOn(diagnosisApi, 'setGameColor').mockResolvedValue(gameFixture());
    renderRoute();
    await user.click(await screen.findByRole('button', { name: 'I was Black' }));
    expect(setGameColor).toHaveBeenCalledWith(gameId, 'black');
    expect(await screen.findByRole('img', { name: 'You play black' })).toBeInTheDocument();
    expect(
      screen.queryByText('Your side was not recorded for this game. Which colour were you?'),
    ).not.toBeInTheDocument();
  });

  test('says when the colour could not be saved', async () => {
    const user = userEvent.setup();
    vi.spyOn(diagnosisApi, 'getGame').mockResolvedValue(
      gameFixture({ playerColor: null, analysisStatus: 'complete' }),
    );
    vi.spyOn(diagnosisApi, 'setGameColor').mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Boom.'),
    );
    renderRoute();
    await user.click(await screen.findByRole('button', { name: 'I was White' }));
    expect(
      await screen.findByText('Your colour could not be saved. Please try again.'),
    ).toBeVisible();
  });
});

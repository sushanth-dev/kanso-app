import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import type { MovePly } from '../api/diagnosis-api.ts';
import {
  JUDGEMENT_GLYPH,
  JUDGEMENT_LABEL,
  MoveCard,
  Notation,
  moverName,
  movingColorOf,
  resultGloss,
  type MoveCardGame,
  type ReviewMistake,
} from './review-pieces.tsx';

function plyFixture(overrides: Partial<MovePly> & { ply: number; san: string }): MovePly {
  return {
    uci: 'e2e4',
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    phase: 'middlegame',
    evaluation: { cp: 30, mate: null },
    bestMoveSan: null,
    bestMoveUci: null,
    clockMs: null,
    moveTimeMs: null,
    ...overrides,
  };
}

function mistakeFixture(overrides: Partial<ReviewMistake> = {}): ReviewMistake {
  return {
    id: 'm-1',
    gameId: 'g-1',
    ply: 6,
    moveNumber: 3,
    movingColor: 'black',
    phase: 'middlegame',
    fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 5 4',
    moveSan: 'Qf6',
    bestMoveSan: 'Nc6',
    evalBefore: { cp: 50, mate: null },
    evalAfter: { cp: -70, mate: null },
    judgement: 'blunder',
    cpLoss: 120,
    winProbDrop: 0.18,
    motif: 'hanging_piece',
    crossedResultBoundary: false,
    halfPointsLost: 0.5,
    opponentElo: null,
    severity: 120,
    ...overrides,
  };
}

const game: MoveCardGame = {
  playerColor: 'black',
  whiteName: 'Magness C',
  blackName: 'Mina',
};

describe('movingColorOf', () => {
  test('reads the side to move off the FEN, not off the ply parity', () => {
    expect(movingColorOf(plyFixture({ ply: 1, san: 'e4' }))).toBe('white');
    expect(
      movingColorOf(
        plyFixture({
          ply: 2,
          san: 'e5',
          fenBefore: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
        }),
      ),
    ).toBe('black');
  });
});

describe('moverName', () => {
  test("uses the game's recorded names", () => {
    expect(moverName('white', game)).toBe('Magness C');
    expect(moverName('black', game)).toBe('Mina');
  });

  test("falls back to the side's colour when a name is missing", () => {
    const anonymous = { ...game, whiteName: null, blackName: null };
    expect(moverName('white', anonymous)).toBe('White');
    expect(moverName('black', anonymous)).toBe('Black');
  });
});

describe('resultGloss', () => {
  test('a draw is a draw from either side', () => {
    expect(resultGloss('1/2-1/2', 'white')).toBe('drew');
    expect(resultGloss('1/2-1/2', 'black')).toBe('drew');
  });

  test("1-0 glosses from the player's colour", () => {
    expect(resultGloss('1-0', 'white')).toBe('won');
    expect(resultGloss('1-0', 'black')).toBe('lost');
  });

  test("0-1 glosses from the player's colour", () => {
    expect(resultGloss('0-1', 'black')).toBe('won');
    expect(resultGloss('0-1', 'white')).toBe('lost');
  });

  test('an unknown colour or an unfinished game glosses to nothing', () => {
    expect(resultGloss('1-0', null)).toBeNull();
    expect(resultGloss('*', 'white')).toBeNull();
  });
});

describe('Notation', () => {
  test('pairs plies into numbered White/Black rows', () => {
    const plies = [
      plyFixture({ ply: 1, san: 'e4' }),
      plyFixture({
        ply: 2,
        san: 'e5',
        fenBefore: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
      }),
      plyFixture({ ply: 3, san: 'Nf3' }),
    ];
    render(<Notation plies={plies} mistakes={[]} currentPly={plies[0]!} onSelect={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Moves' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'e4' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'e5' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nf3' })).toBeInTheDocument();
    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('2.')).toBeInTheDocument();
  });

  test("marks the mistake's judgement glyph and tooltip in the move list", () => {
    const plies = [plyFixture({ ply: 6, san: 'Qf6' })];
    render(
      <Notation
        plies={plies}
        mistakes={[mistakeFixture()]}
        currentPly={plies[0]!}
        onSelect={() => {}}
      />,
    );
    const move = screen.getByRole('button', { name: /Qf6/ });
    expect(move).toHaveTextContent(JUDGEMENT_GLYPH.blunder);
    expect(move).toHaveAttribute('title', JUDGEMENT_LABEL.blunder);
  });

  test('the current ply is pressed; selecting another reports its ply', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const plies = [plyFixture({ ply: 1, san: 'e4' }), plyFixture({ ply: 3, san: 'Nf3' })];
    render(<Notation plies={plies} mistakes={[]} currentPly={plies[0]!} onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: 'e4' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Nf3' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Nf3' }));
    expect(onSelect).toHaveBeenCalledWith(3);
  });
});

describe('MoveCard', () => {
  test('a plain ply addresses the mover by colour', () => {
    const playerPly = plyFixture({
      ply: 6,
      san: 'Qf6',
      fenBefore: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 5 4',
    });
    const { unmount } = render(<MoveCard game={game} ply={playerPly} />);
    expect(screen.getByText(/you played/)).toHaveTextContent('Qf6');
    unmount();

    const opponentPly = plyFixture({ ply: 5, san: 'Nf3' });
    render(<MoveCard game={game} ply={opponentPly} />);
    expect(screen.getByText(/Magness C played/)).toHaveTextContent('Nf3');
  });

  test("a plain ply never calls the opponent's move the player's", () => {
    // Guard against the parity shortcut: ply 5 is White's move, the player is
    // Black, so the card must not say "you played".
    render(<MoveCard game={game} ply={plyFixture({ ply: 5, san: 'Nf3' })} />);
    expect(screen.queryByText(/you played/)).not.toBeInTheDocument();
  });

  test('a plain ply states the running advantage, dash when unknown', () => {
    const { unmount } = render(<MoveCard game={game} ply={plyFixture({ ply: 1, san: 'e4' })} />);
    expect(screen.getByText('Advantage: +0.3')).toBeInTheDocument();
    unmount();

    render(<MoveCard game={game} ply={plyFixture({ ply: 1, san: 'e4', evaluation: null })} />);
    expect(screen.getByText('Advantage: —')).toBeInTheDocument();
  });

  test('a mistake card names the loss, the swing, and the motif', () => {
    render(
      <MoveCard game={game} ply={plyFixture({ ply: 6, san: 'Qf6' })} mistake={mistakeFixture()} />,
    );
    expect(screen.getByText(JUDGEMENT_LABEL.blunder)).toBeInTheDocument();
    expect(screen.getByText('-1.2 pawns')).toBeInTheDocument();
    expect(screen.getByText(/you played/)).toHaveTextContent('Qf6');
    expect(screen.getByText(/best was/)).toHaveTextContent('Nc6');
    expect(screen.getByText('Advantage: +0.5 → -0.7')).toBeInTheDocument();
    expect(screen.getByText('Hung a piece')).toBeInTheDocument();
  });

  test("an opponent's mistake names the opponent as the mover", () => {
    const whiteMistake = mistakeFixture({
      movingColor: 'white',
      moveSan: 'Nf3',
      bestMoveSan: 'Nc3',
    });
    render(
      <MoveCard game={game} ply={plyFixture({ ply: 5, san: 'Nf3' })} mistake={whiteMistake} />,
    );
    expect(screen.getByText(/Magness C played/)).toHaveTextContent('Nf3');
    expect(screen.getByText(/best was/)).toHaveTextContent('Nc3');
  });

  test('an unmapped motif falls back to its raw key, never silence', () => {
    const unmapped = mistakeFixture({ motif: 'time_trouble_blunder' });
    render(<MoveCard game={game} ply={plyFixture({ ply: 6, san: 'Qf6' })} mistake={unmapped} />);
    expect(screen.getByText('time_trouble_blunder')).toBeInTheDocument();
  });

  test('no motif reads as no motif line', () => {
    render(
      <MoveCard
        game={game}
        ply={plyFixture({ ply: 6, san: 'Qf6' })}
        mistake={mistakeFixture({ motif: null })}
      />,
    );
    expect(screen.queryByText('Hung a piece')).not.toBeInTheDocument();
  });

  test('the drill offer is the owner route alone, absent on the shared reader', () => {
    const { unmount } = render(
      <MoveCard
        game={game}
        ply={plyFixture({ ply: 6, san: 'Qf6' })}
        mistake={mistakeFixture()}
        drillHref="/practice?kind=motif&group=hanging_piece"
      />,
    );
    expect(screen.getByRole('link', { name: 'Drill this pattern' })).toHaveAttribute(
      'href',
      '/practice?kind=motif&group=hanging_piece',
    );
    unmount();

    render(
      <MoveCard game={game} ply={plyFixture({ ply: 6, san: 'Qf6' })} mistake={mistakeFixture()} />,
    );
    expect(screen.queryByRole('link', { name: 'Drill this pattern' })).not.toBeInTheDocument();
  });
});

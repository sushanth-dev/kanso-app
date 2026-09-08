import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { GameDetail, MovePly } from '../api/diagnosis-api.ts';
import { ClockCurve, clockCurveState, clockLabel, clockReadings } from './clock-curve.tsx';

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

function blackPly(ply: number, san: string, clockMs: number | null): MovePly {
  return plyFixture({
    ply,
    san,
    fenBefore: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    clockMs,
  });
}

function gameFixture(overrides: Partial<GameDetail> = {}): GameDetail {
  return {
    id: '00000000-0000-4000-8000-0000000000b1',
    stream: 'tournament',
    source: 'pgn_upload',
    playerColor: 'black',
    result: '0-1',
    playedAt: '2026-08-30T10:00:00.000Z',
    event: 'City Open',
    round: 3,
    board: 7,
    whiteName: 'Magness C',
    blackName: 'Mina',
    whiteElo: 1900,
    blackElo: 1750,
    eco: 'C50',
    opening: 'Italian Game',
    moveCount: 40,
    hasClockData: true,
    analysisStatus: 'complete',
    analyzedAt: '2026-08-30T11:00:00.000Z',
    pgn: '*',
    plies: [],
    mistakes: [],
    timeTroubleFromMove: null,
    ...overrides,
  };
}

describe('clockReadings', () => {
  test("takes the player's own readings only, in move numbers", () => {
    const plies = [
      plyFixture({ ply: 1, san: 'e4', clockMs: 60_000 }),
      blackPly(2, 'e5', 55_000),
      plyFixture({ ply: 3, san: 'Nf3', clockMs: 58_000 }),
      blackPly(4, 'Nc6', 40_000),
    ];
    const readings = clockReadings(plies, 'black');
    expect(readings).toEqual([
      { move: 1, clockMs: 55_000 },
      { move: 2, clockMs: 40_000 },
    ]);
  });

  test('skips plies with no recorded clock', () => {
    const readings = clockReadings(
      [plyFixture({ ply: 1, san: 'e4', clockMs: null }), blackPly(2, 'e5', 55_000)],
      'black',
    );
    expect(readings).toEqual([{ move: 1, clockMs: 55_000 }]);
  });

  test('an unknown colour has no readings at all', () => {
    expect(clockReadings([blackPly(2, 'e5', 55_000)], null)).toEqual([]);
  });
});

describe('clockCurveState', () => {
  test('the DEBT-016 vocabulary: none, one, or a drawable curve', () => {
    expect(clockCurveState([])).toBe('no_clock_data');
    expect(clockCurveState([{ move: 1, clockMs: 55_000 }])).toBe('not_enough_evidence');
    expect(
      clockCurveState([
        { move: 1, clockMs: 55_000 },
        { move: 2, clockMs: 40_000 },
      ]),
    ).toBe('curve');
  });
});

describe('clockLabel', () => {
  test('formats minutes and seconds under the hour', () => {
    expect(clockLabel(0)).toBe('0:00');
    expect(clockLabel(65_000)).toBe('1:05');
    expect(clockLabel(600_000)).toBe('10:00');
  });

  test('crosses into H:MM:SS past the hour', () => {
    expect(clockLabel(3_600_000)).toBe('1:00:00');
    expect(clockLabel(3_661_000)).toBe('1:01:01');
  });

  test('rounds to the nearest second', () => {
    expect(clockLabel(59_500)).toBe('1:00');
  });
});

describe('ClockCurve', () => {
  test('an unknown colour asks to be set, with no curve pretending otherwise', () => {
    render(<ClockCurve game={gameFixture({ playerColor: null })} />);
    expect(
      screen.getByText('Set your colour above to see how your clock spent the game.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  test('no clock data states its reason', () => {
    render(<ClockCurve game={gameFixture({ hasClockData: false })} />);
    expect(
      screen.getByText('No clock data on this game, so there is no clock curve.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  test('one reading is too few to draw a line', () => {
    render(<ClockCurve game={gameFixture({ plies: [blackPly(2, 'e5', 55_000)] })} />);
    expect(
      screen.getByText('Too few clock readings on your moves to draw a clock curve.'),
    ).toBeInTheDocument();
  });

  test('two readings draw the curve, described by its endpoints', () => {
    render(
      <ClockCurve
        game={gameFixture({
          plies: [blackPly(2, 'e5', 55_000), blackPly(4, 'Nc6', 40_000)],
        })}
      />,
    );
    const curve = screen.getByRole('img');
    expect(curve).toHaveAccessibleName(
      'Your remaining clock after each of your moves, from 0:55 to 0:40.',
    );
  });

  test('the time-trouble onset is named in the description when it lands inside the game', () => {
    render(
      <ClockCurve
        game={gameFixture({
          timeTroubleFromMove: 2,
          plies: [blackPly(2, 'e5', 55_000), blackPly(4, 'Nc6', 40_000)],
        })}
      />,
    );
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Your remaining clock after each of your moves, from 0:55 to 0:40. Time trouble marked from move 2.',
    );
  });

  test("an onset past the game's last move marks nothing", () => {
    render(
      <ClockCurve
        game={gameFixture({
          timeTroubleFromMove: 30,
          plies: [blackPly(2, 'e5', 55_000), blackPly(4, 'Nc6', 40_000)],
        })}
      />,
    );
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Your remaining clock after each of your moves, from 0:55 to 0:40.',
    );
  });
});

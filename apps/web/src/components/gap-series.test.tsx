import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { TransferGapSeries } from '../api/diagnosis-api.ts';
import { GapSeriesCard, gapLabel, gapSeriesState } from './gap-series.tsx';

function seriesFixture(overrides: Partial<TransferGapSeries> = {}): TransferGapSeries {
  return {
    playerId: '00000000-0000-4000-8000-000000000001',
    platform: 'chesscom',
    onlineRating: 1500,
    points: [
      {
        tournamentId: '00000000-0000-4000-8000-0000000000c1',
        name: 'City Open',
        date: '2026-07-12',
        rating: 1450,
        gap: -50,
      },
      {
        tournamentId: '00000000-0000-4000-8000-0000000000c2',
        name: 'Autumn Classic',
        date: '2026-08-23',
        rating: 1470,
        gap: -30,
      },
    ],
    skippedTournaments: 0,
    ...overrides,
  };
}

describe('gapSeriesState', () => {
  test('no points and no skips is no tournaments', () => {
    expect(gapSeriesState({ onlineRating: 1500, points: [], skippedTournaments: 0 })).toBe(
      'no_tournaments',
    );
  });

  test('no points but skipped events is unrated only', () => {
    expect(gapSeriesState({ onlineRating: 1500, points: [], skippedTournaments: 2 })).toBe(
      'unrated_only',
    );
  });

  test('points without an online rating cannot be read against one', () => {
    expect(
      gapSeriesState({
        onlineRating: null,
        points: [
          { tournamentId: 't1', name: 'City Open', date: '2026-07-12', rating: 1450, gap: null },
        ],
        skippedTournaments: 0,
      }),
    ).toBe('no_online_rating');
  });

  test('a single event is not a trend', () => {
    expect(
      gapSeriesState({
        onlineRating: 1500,
        points: [
          { tournamentId: 't1', name: 'City Open', date: '2026-07-12', rating: 1450, gap: -50 },
        ],
        skippedTournaments: 0,
      }),
    ).toBe('one_event');
  });

  test('two rated points draw the chart', () => {
    expect(gapSeriesState(seriesFixture())).toBe('chart');
  });
});

describe('gapLabel', () => {
  test('signs positive gaps, never zero, and keeps negatives', () => {
    expect(gapLabel(25)).toBe('+25');
    expect(gapLabel(0)).toBe('0');
    expect(gapLabel(-30)).toBe('-30');
  });
});

describe('GapSeriesCard', () => {
  test('the chart state describes the series against the online rating', () => {
    render(<GapSeriesCard series={seriesFixture()} />);
    expect(screen.getByRole('heading', { name: 'The gap across the season' })).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Your gap to Chess.com rapid 1500 across 2 tournaments, from -50 at City Open to -30 at Autumn Classic.',
    );
  });

  test('no tournaments points at the upload', () => {
    render(
      <GapSeriesCard
        series={seriesFixture({ points: [], skippedTournaments: 0, platform: null })}
      />,
    );
    expect(
      screen.getByText(
        'No tournament games yet. Upload a tournament and the gap gets its first point.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  test('unrated events say how many carried no rating, singular and plural', () => {
    const { unmount } = render(
      <GapSeriesCard series={seriesFixture({ points: [], skippedTournaments: 1 })} />,
    );
    expect(
      screen.getByText(
        'Your one tournament carries no player rating in its games, so there is nothing to plot yet.',
      ),
    ).toBeInTheDocument();
    unmount();

    render(<GapSeriesCard series={seriesFixture({ points: [], skippedTournaments: 3 })} />);
    expect(
      screen.getByText(
        'None of your 3 tournaments carry a player rating in their games, so there is nothing to plot yet.',
      ),
    ).toBeInTheDocument();
  });

  test('a missing online rating points at the account, and skips still get their footnote', () => {
    render(
      <GapSeriesCard
        series={seriesFixture({
          onlineRating: null,
          points: [
            { tournamentId: 't1', name: 'City Open', date: '2026-07-12', rating: 1450, gap: null },
          ],
          skippedTournaments: 1,
        })}
      />,
    );
    expect(
      screen.getByText(
        'No online rating fetched yet. Set a Chess.com or Lichess username on your account and refresh the ratings; every point reads against your latest online rating.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'One other event carries no player rating in its games, so it has no point.',
      ),
    ).toBeInTheDocument();
  });

  test('one event draws its point but refuses to call it a trend', () => {
    render(
      <GapSeriesCard
        series={seriesFixture({
          points: [
            { tournamentId: 't1', name: 'City Open', date: '2026-07-12', rating: 1450, gap: -50 },
          ],
        })}
      />,
    );
    expect(
      screen.getByText(
        'One tournament so far. The direction needs a second event - one point is not a trend.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Your gap to Chess.com rapid 1500 across 1 tournament: -50 at City Open.',
    );
  });

  test('plural skips footnote their plural phrasing under a drawn chart', () => {
    render(<GapSeriesCard series={seriesFixture({ skippedTournaments: 2 })} />);
    expect(
      screen.getByText(
        '2 other events carry no player rating in their games, so they have no points.',
      ),
    ).toBeInTheDocument();
  });

  test('the Lichess reference labels itself by platform', () => {
    render(<GapSeriesCard series={seriesFixture({ platform: 'lichess' })} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Your gap to Lichess rapid 1500 across 2 tournaments, from -50 at City Open to -30 at Autumn Classic.',
    );
  });
});

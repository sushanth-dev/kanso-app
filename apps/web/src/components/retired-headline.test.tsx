/**
 * ST-151. The headline's rules: the count reads the patterns table alone
 * and nothing shaped like a puzzle attempt, the evidence link appears only
 * once a stream has something to show, the zero is honest about what
 * starts a pattern, and a failed stream never blocks its sibling.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { diagnosisApi, type PatternReport } from '../api/diagnosis-api.ts';
import { RetiredHeadline } from './retired-headline.tsx';

vi.mock('../analytics.ts', () => ({
  safeProperties: (properties: Record<string, string | number>) => properties,
  track: vi.fn(),
}));

const playerId = '00000000-0000-4000-8000-000000000001';

function patternFixture(overrides: Partial<PatternReport['patterns'][number]> = {}) {
  return {
    kind: 'motif' as const,
    groupKey: 'hanging_piece',
    label: 'Hanging piece',
    stream: 'tournament' as const,
    state: 'candidate' as const,
    masteredAt: '2026-08-01T00:00:00.000Z',
    retiredAt: null,
    cameBackAt: null,
    lastAlertGame: null,
    windowGames: 6,
    windowInstances: 3,
    windowCost: 187.5,
    relapses: 0,
    ...overrides,
  };
}

function reportFixture(
  stream: PatternReport['stream'],
  patterns: PatternReport['patterns'],
  verificationFloor = 10,
): PatternReport {
  return { playerId, stream, verificationFloor, patterns };
}

function renderHeadline() {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <RetiredHeadline streams={['tournament', 'online']} />
    </QueryClientProvider>,
  );
}

describe('RetiredHeadline', () => {
  test('renders both streams counts from the patterns read alone', async () => {
    const getPatterns = vi
      .spyOn(diagnosisApi, 'getPatterns')
      .mockImplementation((stream) =>
        Promise.resolve(
          reportFixture(stream, [
            patternFixture({ state: 'retired', stream }),
            patternFixture({ state: 'retired', groupKey: 'fork', stream }),
            patternFixture({ state: 'candidate', groupKey: 'pin', stream }),
          ]),
        ),
      );

    renderHeadline();

    await waitFor(() => expect(screen.getAllByText('2')).toHaveLength(2));
    expect(screen.getByText('retired · tournament')).toBeVisible();
    expect(screen.getByText('retired · online')).toBeVisible();
    // Pins the single-writer claim: the count never asks the practice-review
    // (puzzle-attempt-shaped) endpoint.
    expect(getPatterns).toHaveBeenCalledWith('tournament');
    expect(getPatterns).toHaveBeenCalledWith('online');
  });

  test('the evidence link only appears once a stream has a retired count', async () => {
    vi.spyOn(diagnosisApi, 'getPatterns').mockImplementation((stream) =>
      Promise.resolve(
        reportFixture(
          stream,
          stream === 'tournament' ? [patternFixture({ state: 'retired', stream })] : [],
        ),
      ),
    );

    renderHeadline();

    const link = await screen.findByRole('link', { name: 'See the evidence' });
    expect(link).toHaveAttribute('href', '/report?stream=tournament#debt-board');
    expect(screen.queryByRole('link', { name: /online/ })).not.toBeInTheDocument();
  });

  test('the honest zero names the stream and its verification floor', async () => {
    vi.spyOn(diagnosisApi, 'getPatterns').mockImplementation((stream) =>
      Promise.resolve(reportFixture(stream, [], 14)),
    );

    renderHeadline();

    expect(
      await screen.findByText(
        'Drill a weakness to mastery, then keep it out of your tournament games across the next 14 to retire it.',
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Drill a weakness to mastery, then keep it out of your online games across the next 14 to retire it.',
      ),
    ).toBeVisible();
  });

  test('a failed stream renders nothing without blocking its sibling', async () => {
    vi.spyOn(diagnosisApi, 'getPatterns').mockImplementation((stream) =>
      stream === 'tournament'
        ? Promise.reject(new Error('down'))
        : Promise.resolve(reportFixture(stream, [patternFixture({ state: 'retired', stream })])),
    );

    renderHeadline();

    expect(await screen.findByText('retired · online')).toBeVisible();
    await waitFor(() => expect(screen.queryByText('retired · tournament')).not.toBeInTheDocument());
  });
});

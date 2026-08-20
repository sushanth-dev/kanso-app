import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router';
import { describe, expect, test, vi } from 'vitest';
import type { MotifReport, PhaseReport, Report } from '../api/diagnosis-api.ts';
import { createAppRouter } from '../router.tsx';
import { ReportScreen } from './report-route.tsx';

const playerId = '00000000-0000-4000-8000-000000000001';

const motifWeakness = {
  id: 'w-1',
  kind: 'motif' as const,
  label: 'Missed captures',
  eco: null,
  ratingLeak: 34,
  saturated: false,
  halfPointsLost: 2.5,
  gamesAffected: 6,
  occurrences: 9,
  rank: 1,
};

const openingWeakness = {
  id: 'w-2',
  kind: 'opening' as const,
  label: 'Sicilian, Alapin',
  eco: 'B22',
  ratingLeak: 21,
  saturated: false,
  halfPointsLost: 1.5,
  gamesAffected: 4,
  occurrences: 5,
  rank: 2,
};

function reportFixture(overrides: Partial<Report> = {}): Report {
  return {
    id: 'report-1',
    playerId,
    stream: 'tournament',
    generatedAt: '2026-08-15T12:00:00.000Z',
    gamesCovered: 12,
    windowStart: '2025-09-01T00:00:00.000Z',
    windowEnd: '2026-05-31T00:00:00.000Z',
    timeTroubleFromMove: null,
    timeTroubleReason: null,
    weaknesses: [motifWeakness, openingWeakness],
    narrative: null,
    ...overrides,
  };
}

const motifReportFixture: MotifReport = {
  playerId,
  stream: 'tournament',
  motifs: [{ motif: 'missed_capture', positions: 9, totalCpLoss: 128 }],
  unattributed: 2,
  mistakeCount: 11,
  withheld: 0,
};

const phaseReportFixture: PhaseReport = {
  playerId,
  stream: 'tournament',
  phases: [{ phase: 'middlegame', totalCpLoss: 96, games: 7 }],
  mistakeCount: 11,
  timeTrouble: { status: 'unavailable', reason: 'no_clock_data' },
};

function renderReport(report: Report, onStreamChange = vi.fn()) {
  const user = userEvent.setup();
  const history = createMemoryHistory();
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <ReportScreen
          stream={report.stream}
          report={report}
          playerId={playerId}
          onStreamChange={onStreamChange}
        />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
  return { user, queryClient, onStreamChange };
}

describe('ReportScreen', () => {
  test('renders the ranked list with evidence and the coverage meta', () => {
    renderReport(reportFixture());
    expect(
      screen.getByRole('heading', { level: 1, name: 'Tournament report' }),
    ).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('Missed captures')).toBeInTheDocument();
    expect(screen.getByText('34')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('2.5')).toBeInTheDocument();
    expect(screen.getByText(/covering 12 games/)).toBeInTheDocument();
  });

  test('renders an honest statement, not a clean bill of health, for an empty report', () => {
    renderReport(reportFixture({ weaknesses: [] }));
    expect(
      screen.getByRole('heading', { name: 'Not enough evidence to rank yet' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/could not identify a defensible weakness/)).toBeInTheDocument();
  });

  test('shows the stream choice and never blends it', async () => {
    const { user, onStreamChange } = renderReport(reportFixture());
    expect(screen.getByRole('button', { name: 'Tournament' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Online' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Online' }));
    expect(onStreamChange).toHaveBeenCalledWith('online');
  });

  test('expands a motif weakness into the aggregate behind it', async () => {
    const { user, queryClient } = renderReport(reportFixture());
    queryClient.setQueryData(['motifs', playerId, 'tournament'], motifReportFixture);
    await user.click(screen.getByRole('button', { name: 'Show evidence' }));
    expect(await screen.findByText(/9 positions, 128 cp lost/)).toBeInTheDocument();
    expect(screen.getByText(/11 mistakes counted/)).toBeInTheDocument();
  });

  test('states what could not be assessed when time trouble is unavailable', async () => {
    const report = reportFixture({
      weaknesses: [
        {
          id: 'w-3',
          kind: 'phase',
          label: 'Middlegame',
          eco: null,
          ratingLeak: 15,
          saturated: false,
          halfPointsLost: 1,
          gamesAffected: 5,
          occurrences: 6,
          rank: 1,
        },
      ],
    });
    const { user, queryClient } = renderReport(report);
    queryClient.setQueryData(['phases', playerId, 'tournament'], phaseReportFixture);
    await user.click(screen.getByRole('button', { name: 'Show evidence' }));
    expect(await screen.findAllByText(/These games do not carry clock data/)).toHaveLength(2);
  });

  test('states a saturated leak as a floor in words, not a bare number', () => {
    renderReport(
      reportFixture({
        weaknesses: [{ ...motifWeakness, ratingLeak: 702, saturated: true }],
      }),
    );
    expect(screen.getByText('at least 702')).toBeInTheDocument();
  });

  test('shows the time-trouble move on an online report', () => {
    renderReport(reportFixture({ stream: 'online', timeTroubleFromMove: 28 }));
    expect(screen.getByText(/Time trouble starts around move/)).toBeInTheDocument();
    expect(screen.getByText('28')).toHaveClass('font-mono');
  });

  test('states the reason when time trouble data is absent', () => {
    renderReport(reportFixture());
    expect(screen.getByText('These games do not carry clock data.')).toBeInTheDocument();
  });

  test('states the thin-history reason when the clocked games do not hold', () => {
    renderReport(reportFixture({ timeTroubleReason: 'not_enough_evidence' }));
    expect(
      screen.getByText('Not enough clocked games to measure time trouble yet.'),
    ).toBeInTheDocument();
  });

  test('labels the evidence figures on a ranked report', () => {
    renderReport(reportFixture({ weaknesses: [motifWeakness] }));
    expect(screen.getByText('games')).toBeInTheDocument();
    expect(screen.getByText('occurrences')).toBeInTheDocument();
    expect(screen.getByText('half-points lost')).toBeInTheDocument();
  });
});

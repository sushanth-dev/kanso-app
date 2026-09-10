/**
 * ST-152. The drill surface's debt card: the group's own row from the
 * patterns read, the honest line for a group that never mastered, and a
 * broken read that costs the drill nothing.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { diagnosisApi, type PatternReport } from '../api/diagnosis-api.ts';
import { PracticeDebtCard } from './practice-route.tsx';

const playerId = '00000000-0000-4000-8000-000000000001';

function patternsFixture(patterns: PatternReport['patterns']): PatternReport {
  return { playerId, stream: 'tournament', verificationFloor: 10, patterns };
}

function patternFixture() {
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
  };
}

function renderDebtCard() {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <PracticeDebtCard kind="motif" group="hanging_piece" stream="tournament" />
    </QueryClientProvider>,
  );
}

describe('PracticeDebtCard', () => {
  test('renders the group’s debt card from the patterns read', async () => {
    vi.spyOn(diagnosisApi, 'getPatterns').mockResolvedValue(patternsFixture([patternFixture()]));

    renderDebtCard();

    expect(await screen.findByText('Hanging piece')).toBeVisible();
    expect(screen.getByText('3 instances · 187.5 half-points')).toBeVisible();
  });

  test('a group that never mastered names what starts its window', async () => {
    vi.spyOn(diagnosisApi, 'getPatterns').mockResolvedValue(patternsFixture([]));

    renderDebtCard();

    expect(
      await screen.findByText(/Not on the debt board yet: drill the group to mastery/),
    ).toBeVisible();
  });

  test('a broken board read never blocks the drill', async () => {
    vi.spyOn(diagnosisApi, 'getPatterns').mockRejectedValue(new Error('down'));

    renderDebtCard();

    expect(await screen.findByText(/The debt board could not load/)).toBeVisible();
  });

  test('a pending read renders nothing and the drill starts', () => {
    const { promise } = Promise.withResolvers<PatternReport>();
    vi.spyOn(diagnosisApi, 'getPatterns').mockReturnValue(promise);

    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <PracticeDebtCard kind="motif" group="hanging_piece" stream="tournament" />
      </QueryClientProvider>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * ST-152. The debt board's rules: the balance renders from the read model
 * and nothing else, the relapse stays visible, every state carries icon and
 * text, and the empty, loading, and error states follow the shared
 * vocabulary.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { diagnosisApi, type PatternReport, type Weakness } from '../api/diagnosis-api.ts';
import { DebtBoard } from './debt-board.tsx';

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
    calibration: null,
    ...overrides,
  };
}

function boardFixture(patterns: PatternReport['patterns']): PatternReport {
  return { playerId, stream: 'tournament', verificationFloor: 10, patterns };
}

function renderBoard(weaknesses: Weakness[] = []) {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <DebtBoard stream="tournament" weaknesses={weaknesses} />
    </QueryClientProvider>,
  );
}

describe('DebtBoard', () => {
  test('renders the balance from the read model, and the effort beside it', async () => {
    vi.spyOn(diagnosisApi, 'getPatterns').mockResolvedValue(boardFixture([patternFixture()]));
    const weakness = {
      id: 'w-1',
      kind: 'motif' as const,
      groupKey: 'hanging_piece',
      label: 'Hanging piece',
      drilled: 42,
    } as Weakness;

    renderBoard([weakness]);

    expect(await screen.findByText('3 instances · 187.5 half-points')).toBeVisible();
    expect(screen.getByText('6 games')).toBeVisible();
    expect(screen.getByText('42 drills')).toBeVisible();
  });

  // ST-175, criterion 7. Every figure on a card is a count - the balance, the
  // window, the drills beside it, the state read from them - so the card says so.
  test('labels its figures as observed', async () => {
    vi.spyOn(diagnosisApi, 'getPatterns').mockResolvedValue(boardFixture([patternFixture()]));

    renderBoard();

    expect(
      await screen.findByText(
        'Observed · counted from these games and your drills, not modelled from engine scores.',
      ),
    ).toBeVisible();
  });

  test('a came-back card keeps the relapse in the history', async () => {
    vi.spyOn(diagnosisApi, 'getPatterns').mockResolvedValue(
      boardFixture([
        patternFixture({
          state: 'came_back',
          cameBackAt: '2026-09-01T00:00:00.000Z',
          relapses: 1,
          lastAlertGame: {
            gameId: '00000000-0000-4000-8000-0000000000ab',
            playedAt: '2026-09-01T00:00:00.000Z',
            whiteName: 'Mina',
            blackName: 'Rival',
          },
        }),
      ]),
    );

    renderBoard();

    expect(await screen.findByText(/Came back once, latest Sep 1, 2026 in/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Mina vs Rival' })).toBeVisible();
  });

  test('the retired card names the stream and the window that retired it', async () => {
    vi.spyOn(diagnosisApi, 'getPatterns').mockResolvedValue(
      boardFixture([
        patternFixture({
          state: 'retired',
          retiredAt: '2026-09-20T00:00:00.000Z',
          windowInstances: 0,
          windowCost: 0,
        }),
      ]),
    );

    renderBoard();

    expect(
      await screen.findByText('Paid in full: retired Sep 20, 2026 by a clean tournament window.'),
    ).toBeVisible();
    expect(screen.queryByText('owed')).not.toBeInTheDocument();
  });

  test('every state carries icon and text, never hue alone', async () => {
    const states = ['candidate', 'not_yet_verifiable', 'retired', 'came_back'] as const;
    vi.spyOn(diagnosisApi, 'getPatterns').mockResolvedValue(
      boardFixture(states.map((state, i) => patternFixture({ state, groupKey: `g${i}` }))),
    );

    renderBoard([]);

    const cards = await screen.findAllByRole('listitem');
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(within(card).getByText(/Retired|Retirement candidate|Not yet verifiable|Came back/));
      // The icon channel: an inline svg beside the badge's text.
      expect(card.querySelector('svg')).not.toBeNull();
    }
  });

  test('the board reads in payoff order: reopened debts, running windows, paid debts', async () => {
    vi.spyOn(diagnosisApi, 'getPatterns').mockResolvedValue(
      boardFixture([
        patternFixture({ state: 'retired', label: 'Aa paid', groupKey: 'paid' }),
        patternFixture({ state: 'came_back', label: 'Bb reopened', groupKey: 'reopened' }),
        patternFixture({ state: 'candidate', label: 'Cc running', groupKey: 'running' }),
      ]),
    );

    renderBoard([]);

    const cards = await screen.findAllByRole('listitem');
    expect(cards[0]!.textContent).toContain('Bb reopened');
    expect(cards[1]!.textContent).toContain('Cc running');
    expect(cards[2]!.textContent).toContain('Aa paid');
  });

  test('the empty board is an honest zero naming what starts a debt', async () => {
    vi.spyOn(diagnosisApi, 'getPatterns').mockResolvedValue(boardFixture([]));

    renderBoard([]);

    expect(await screen.findByText('No debts on the board yet')).toBeVisible();
    expect(screen.getByText(/10 of your games without the pattern retires the debt/)).toBeVisible();
  });

  test('ST-156 the card names the overconfidence share with the trailing week', async () => {
    vi.spyOn(diagnosisApi, 'getPatterns').mockResolvedValue(
      boardFixture([
        patternFixture({
          calibration: {
            failedAnswered: 4,
            overconfidence: 0.75,
            weekFailedAnswered: 2,
            weekOverconfidence: 1,
          },
        }),
      ]),
    );

    renderBoard([]);

    expect(
      await screen.findByText(
        'Rated sure on 75% of 4 puzzles whose latest drill failed, 100% in the last week.',
      ),
    ).toBeVisible();
  });

  test('ST-156 a card with no calibration data renders the honest zero', async () => {
    vi.spyOn(diagnosisApi, 'getPatterns').mockResolvedValue(boardFixture([patternFixture()]));

    renderBoard([]);

    expect(
      await screen.findByText(/No calibration data yet\. The drill asks how sure you were/),
    ).toBeVisible();
  });

  test('a failed board read shows its own state and a retry', async () => {
    const getPatterns = vi.spyOn(diagnosisApi, 'getPatterns').mockRejectedValue(new Error('down'));
    const user = userEvent.setup();

    renderBoard();

    expect(await screen.findByText('The debt board could not load')).toBeVisible();
    const callsBefore = getPatterns.mock.calls.length;
    await user.click(screen.getByText('Try again'));
    await waitFor(() => expect(getPatterns.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  test('the board is pending while the read runs', () => {
    const { promise } = Promise.withResolvers<PatternReport>();
    vi.spyOn(diagnosisApi, 'getPatterns').mockReturnValue(promise);

    renderBoard([]);

    expect(screen.getByRole('status')).toBeVisible();
  });
});

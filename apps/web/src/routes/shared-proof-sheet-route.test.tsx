import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError } from '../api/account-api.ts';
import { sharedProofSheetApi, type SharedProofSheet } from '../api/proof-sheet-api.ts';
import { createAppRouter } from '../router.tsx';
import { SharedProofSheetScreen } from './shared-proof-sheet-route.tsx';

function sharedFixture(overrides: Partial<SharedProofSheet> = {}): SharedProofSheet {
  return {
    playerDisplayName: 'Mina',
    focusTitle: 'Converting won positions',
    coachInstruction: null,
    stream: 'tournament',
    unit: 'share converted',
    beforeValue: 0.42,
    afterValue: 0.55,
    trend: 'improving',
    gamesBefore: 10,
    gamesAfter: 8,
    periodStart: '2026-01-01T00:00:00.000Z',
    periodEnd: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SharedProofSheetScreen', () => {
  test('renders the focus, the verdict, the numbers with unit and games, and the stream and period', () => {
    render(<SharedProofSheetScreen sheet={sharedFixture()} />);

    expect(screen.getByText("Mina's focus")).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Converting won positions' })).toBeInTheDocument();
    expect(screen.getByText('It is improving.')).toBeInTheDocument();
    expect(screen.getByText(/0\.42/)).toBeInTheDocument();
    expect(screen.getByText(/0\.55/)).toBeInTheDocument();
    expect(screen.getAllByText('share converted')).toHaveLength(2);
    expect(screen.getByText('over 10 games')).toBeInTheDocument();
    expect(screen.getByText('over 8 games')).toBeInTheDocument();
    expect(screen.getByText(/Tournament games · Jan 1, 2026 to Jun 1, 2026/)).toBeInTheDocument();
  });

  test('renders insufficient evidence as a sentence with the games, not a zero or a blank', () => {
    render(
      <SharedProofSheetScreen
        sheet={sharedFixture({
          trend: 'insufficient_evidence',
          beforeValue: null,
          afterValue: null,
          gamesAfter: 0,
        })}
      />,
    );

    expect(
      screen.getByText('There is not enough evidence yet to say whether it is helping.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/10 games before the focus, 0 games since/)).toBeInTheDocument();
    expect(screen.getByText(/more games will make a verdict possible/i)).toBeInTheDocument();
    expect(screen.queryByText(/share converted/)).not.toBeInTheDocument();
  });

  test('renders the coach instruction verbatim as text, never as markup', () => {
    const instruction = 'Work on <script>window.pwned = true</script> tactics';
    render(<SharedProofSheetScreen sheet={sharedFixture({ coachInstruction: instruction })} />);

    expect(screen.getByText(instruction)).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
  });
});

describe('SharedProofSheetRoute', () => {
  test('shows the one indistinguishable unavailable page for a revoked or unknown link', async () => {
    vi.spyOn(sharedProofSheetApi, 'getShared').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No such page.'),
    );

    const history = createMemoryHistory({ initialEntries: ['/shared/proof-sheets/dead'] });
    const queryClient = new QueryClient();
    const router = createAppRouter({ history, queryClient });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('heading', { name: 'This link is no longer available.' }),
    ).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  test('renders the flat and declining verdicts with their arrows', () => {
    render(<SharedProofSheetScreen sheet={sharedFixture({ trend: 'flat' })} />);
    expect(screen.getByText('It has not changed yet.')).toBeInTheDocument();
    expect(screen.getByText('→')).toBeInTheDocument();

    render(<SharedProofSheetScreen sheet={sharedFixture({ trend: 'declining' })} />);
    expect(screen.getByText('It is declining.')).toBeInTheDocument();
    expect(screen.getByText('↓')).toBeInTheDocument();
  });

  test('renders a missing number as a dash, the singular game count, and the online stream', () => {
    render(
      <SharedProofSheetScreen
        sheet={sharedFixture({
          trend: 'flat',
          beforeValue: null,
          afterValue: null,
          gamesBefore: 1,
          gamesAfter: 1,
          stream: 'online',
        })}
      />,
    );

    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.getAllByText('over 1 game')).toHaveLength(2);
    expect(screen.getByText(/Online games · /)).toBeInTheDocument();
  });

  test('sets the document title to the focus and restores it on unmount', () => {
    const { unmount } = render(<SharedProofSheetScreen sheet={sharedFixture()} />);

    expect(document.title).toBe('Converting won positions · Kanso Chess');
    unmount();
    expect(document.title).toBe('Kanso Chess');
  });

  test('shows a loading status while the shared page is fetched', async () => {
    const { promise } = Promise.withResolvers<SharedProofSheet>();
    vi.spyOn(sharedProofSheetApi, 'getShared').mockReturnValue(promise);

    const history = createMemoryHistory({ initialEntries: ['/shared/proof-sheets/live'] });
    const queryClient = new QueryClient();
    const router = createAppRouter({ history, queryClient });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
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

  test('renders the unreachable page for a server error, never "no longer available" or a verdict', async () => {
    vi.spyOn(sharedProofSheetApi, 'getShared').mockRejectedValue(
      new ApiRequestError(500, 'server_error', undefined, 'Boom.'),
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
      await screen.findByRole('heading', { name: 'This page could not be reached.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Check your connection and try again.')).toBeInTheDocument();
    expect(screen.queryByText('This link is no longer available.')).not.toBeInTheDocument();
    expect(screen.queryByText('It is improving.')).not.toBeInTheDocument();
  });

  test('renders the same unreachable page for a network failure', async () => {
    vi.spyOn(sharedProofSheetApi, 'getShared').mockRejectedValue(new TypeError('Failed to fetch'));

    const history = createMemoryHistory({ initialEntries: ['/shared/proof-sheets/dead'] });
    const queryClient = new QueryClient();
    const router = createAppRouter({ history, queryClient });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('heading', { name: 'This page could not be reached.' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('This link is no longer available.')).not.toBeInTheDocument();
  });

  test('clicking "Try again" refetches', async () => {
    const user = userEvent.setup();
    const getShared = vi
      .spyOn(sharedProofSheetApi, 'getShared')
      .mockRejectedValue(new TypeError('Failed to fetch'));

    const history = createMemoryHistory({ initialEntries: ['/shared/proof-sheets/dead'] });
    const queryClient = new QueryClient();
    const router = createAppRouter({ history, queryClient });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('heading', { name: 'This page could not be reached.' }),
    ).toBeInTheDocument();

    getShared.mockResolvedValue(sharedFixture());
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByRole('heading', { name: 'Converting won positions' }),
    ).toBeInTheDocument();
    expect(getShared).toHaveBeenCalledTimes(2);
  });
});

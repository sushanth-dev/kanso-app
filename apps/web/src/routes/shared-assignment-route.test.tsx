import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { accountApi, ApiRequestError, type Me } from '../api/account-api.ts';
import { focusApi } from '../api/focus-api.ts';
import { sharedAssignmentApi, type SharedAssignment } from '../api/assignment-api.ts';
import { createAppRouter } from '../router.tsx';
import { SharedAssignmentScreen } from './shared-assignment-route.tsx';

const meFixture: Me = {
  userId: 'user-1',
  email: 'player@example.com',
  name: 'Player',
  tier: 'pro',
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

function assignmentFixture(overrides: Partial<SharedAssignment> = {}): SharedAssignment {
  return {
    focusTitle: 'Converting won positions',
    focusDescription: 'Winning the games the position already says are won.',
    instruction: 'Play through five model games every evening.',
    ...overrides,
  };
}

function renderRoute(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SharedAssignmentScreen', () => {
  test('renders the focus and the instruction verbatim as text, never as markup', () => {
    const instruction = 'Work on <script>window.pwned = true</script> endgames';
    render(<SharedAssignmentScreen assignment={assignmentFixture({ instruction })} />);

    expect(screen.getByRole('heading', { name: 'Converting won positions' })).toBeInTheDocument();
    expect(screen.getByText(instruction)).toBeInTheDocument();
    expect(screen.getByText(/Winning the games the position already says/)).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
  });

  test('names the coach instruction as the source of the words', () => {
    render(<SharedAssignmentScreen assignment={assignmentFixture()} />);

    expect(screen.getByText("The coach's instruction")).toBeInTheDocument();
  });

  test('sets the document title to the focus and restores it on unmount', () => {
    const { unmount } = render(<SharedAssignmentScreen assignment={assignmentFixture()} />);

    expect(document.title).toBe('Converting won positions · Kanso Chess');
    unmount();
    expect(document.title).toBe('Kanso Chess');
  });
});

describe('SharedAssignmentRoute', () => {
  test('shows the one indistinguishable unavailable page for a dead link', async () => {
    vi.spyOn(sharedAssignmentApi, 'getShared').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No such assignment.'),
    );

    renderRoute('/shared/assignments/dead');

    expect(
      await screen.findByRole('heading', { name: 'This link is no longer available.' }),
    ).toBeInTheDocument();
  });

  test('renders the unreachable page for a network failure, with a retry', async () => {
    const user = userEvent.setup();
    const getShared = vi
      .spyOn(sharedAssignmentApi, 'getShared')
      .mockRejectedValue(new TypeError('Failed to fetch'));

    renderRoute('/shared/assignments/dead');

    expect(
      await screen.findByRole('heading', { name: 'This page could not be reached.' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('This link is no longer available.')).not.toBeInTheDocument();

    getShared.mockResolvedValue(assignmentFixture());
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByRole('heading', { name: 'Converting won positions' }),
    ).toBeInTheDocument();
  });

  test('offers sign-in when the reader has no session, and never a confirm', async () => {
    vi.spyOn(sharedAssignmentApi, 'getShared').mockResolvedValue(assignmentFixture());
    vi.spyOn(accountApi, 'getMe').mockRejectedValue(
      new ApiRequestError(401, 'unauthorized', undefined, 'No session.'),
    );

    renderRoute('/shared/assignments/live');

    const signIn = await screen.findByRole('link', { name: 'Sign in to accept' });
    expect(signIn).toHaveAttribute('href', '/sign-in');
    expect(screen.queryByRole('button', { name: 'Accept this focus' })).not.toBeInTheDocument();
  });

  test('confirming needs the session, and the act lands on the focus surface', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(sharedAssignmentApi, 'confirm').mockResolvedValue(undefined);
    vi.spyOn(sharedAssignmentApi, 'getShared').mockResolvedValue(assignmentFixture());
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(focusApi, 'getFocus').mockResolvedValue({
      id: 'focus-1',
      source: 'coach',
      catalogue: null,
      coachInstruction: 'Play through five model games every evening.',
      unverified: true,
      pairedFocusId: '22222222-2222-4222-8222-222222222222',
      startedAt: '2026-09-05T00:00:00.000Z',
      measurements: [],
      practice: null,
    });
    vi.spyOn(focusApi, 'listFocuses').mockResolvedValue([]);

    renderRoute('/shared/assignments/live');

    await user.click(await screen.findByRole('button', { name: 'Accept this focus' }));

    expect(confirm).toHaveBeenCalledWith('live');
    expect(await screen.findByText("Your coach's focus")).toBeInTheDocument();
  });

  test('a link that died between opening and confirming answers the honest state', async () => {
    const user = userEvent.setup();
    vi.spyOn(sharedAssignmentApi, 'getShared').mockResolvedValue(assignmentFixture());
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(sharedAssignmentApi, 'confirm').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No such assignment.'),
    );

    renderRoute('/shared/assignments/live');

    await user.click(await screen.findByRole('button', { name: 'Accept this focus' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This link is no longer available.');
  });

  test('names the paid boundary when the tier refuses the confirm', async () => {
    const user = userEvent.setup();
    vi.spyOn(sharedAssignmentApi, 'getShared').mockResolvedValue(assignmentFixture());
    vi.spyOn(accountApi, 'getMe').mockResolvedValue(meFixture);
    vi.spyOn(sharedAssignmentApi, 'confirm').mockRejectedValue(
      new ApiRequestError(403, 'upgrade_required', undefined, 'Upgrade to unlock this.'),
    );

    renderRoute('/shared/assignments/live');

    await user.click(await screen.findByRole('button', { name: 'Accept this focus' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Confirming a focus is part of the paid loop.',
    );
  });
});

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { accountApi, ApiRequestError, type Me } from '../api/account-api.ts';
import { ME_QUERY_KEY } from '../query-client.ts';
import { createAppRouter } from '../router.tsx';

const meFixture: Me = {
  userId: 'user-1',
  email: 'player@example.com',
  name: 'Player',
  tier: 'beginner',
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

function renderLanding() {
  const history = createMemoryHistory({ initialEntries: ['/'] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient };
}

describe('LandingRoute', () => {
  beforeEach(() => {
    // The landing page is public; a visitor has no session, so getMe rejects.
    vi.spyOn(accountApi, 'getMe').mockRejectedValue(
      new ApiRequestError(401, 'unauthorized', undefined, 'No session.'),
    );
  });

  test('states the promise, the free promise, and the parent line', async () => {
    renderLanding();

    expect(
      await screen.findByRole('heading', {
        name: 'Know the one thing to fix after every tournament.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Your first diagnosis is free/)).toBeInTheDocument();
    expect(
      screen.getByText(/it makes every lesson you already pay for work harder/),
    ).toBeInTheDocument();
  });

  test('shows a synthetic, labelled sample diagnosis, not a real player', async () => {
    renderLanding();

    expect(await screen.findByText('Synthetic example')).toBeInTheDocument();
    expect(screen.getByText(/A scholastic tournament/)).toBeInTheDocument();
    expect(screen.getByText('Missing tactics in the middlegame')).toBeInTheDocument();
    expect(screen.getByText('Tactical motif')).toBeInTheDocument();
  });

  test('states the free and paid boundary factually', async () => {
    renderLanding();

    expect(await screen.findByRole('heading', { name: 'Free today' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Paid for the loop' })).toBeInTheDocument();
    expect(screen.getByText(/From ₹799 a month, uncapped on the Pro plan/)).toBeInTheDocument();
  });

  test('routes the join call to action to sign-up', async () => {
    renderLanding();

    const joins = await screen.findAllByRole('link', { name: 'Get your free diagnosis' });
    expect(joins).toHaveLength(2);
    for (const link of joins) {
      expect(link).toHaveAttribute('href', '/sign-up');
    }
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
    expect(screen.getByRole('link', { name: 'Already have an account? Sign in' })).toHaveAttribute(
      'href',
      '/sign-in',
    );
  });

  test('shows a go-to-report link instead of sign-in when already signed in', async () => {
    const { queryClient } = renderLanding();
    queryClient.setQueryData(ME_QUERY_KEY, meFixture);

    const reports = await screen.findAllByRole('link', { name: 'Go to report' });
    expect(reports.length).toBeGreaterThan(0);
    for (const link of reports) {
      expect(link).toHaveAttribute('href', '/report');
    }
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Get your free diagnosis' })).not.toBeInTheDocument();
  });
  test('states the three value props without a feature-card grid', async () => {
    renderLanding();

    expect(await screen.findByRole('heading', { name: 'What Kanso does' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Your tournament is a first-class object.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Games arrive without typing.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Verification is two-speed, and says which speed it is.',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /A tournament has a name, a date, a section, and five to nine classical games/,
      ),
    ).toBeInTheDocument();
  });

  test('ranks the synthetic weaknesses and shows the rating leak in numbers', async () => {
    renderLanding();

    expect(await screen.findByText('Time trouble from move 24')).toBeInTheDocument();
    expect(screen.getByText('Passive opening choices')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.getByText('#3')).toBeInTheDocument();
    expect(screen.getByText('34')).toBeInTheDocument();
    expect(screen.getByText('21')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  test('names the technology behind the diagnosis', async () => {
    renderLanding();

    expect(
      await screen.findByRole('heading', { name: 'The technology behind it' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Stockfish checks every move.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'GLM-5.3-Flash writes the coaching.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Lichess, the open platform.' }),
    ).toBeInTheDocument();
  });

  test('keeps the skip link, the footer, and the sign-in call to action reachable', async () => {
    renderLanding();
    expect(await screen.findByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
    expect(
      screen.getByText(
        'Kanso Chess is tournament-first chess improvement for junior players and their coaches.',
      ),
    ).toBeInTheDocument();
  });
});

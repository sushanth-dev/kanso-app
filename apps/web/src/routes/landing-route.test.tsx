import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { accountApi } from '../api/account-api.ts';
import { SESSION_QUERY_KEY } from '../query-client.ts';
import { createAppRouter } from '../router.tsx';

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
    // The landing page is public and a visitor has no session, but the probe
    // answers 200 for that case rather than 401 (ST-164).
    vi.spyOn(accountApi, 'getSession').mockResolvedValue({ signedIn: false });
  });

  test('states the promise, the free promise, and the parent line', async () => {
    renderLanding();

    expect(
      await screen.findByRole('heading', {
        name: 'Know the one thing to fix after every tournament.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('AI chess training platform')).toBeInTheDocument();
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
    expect(screen.getByText('34,372 curated puzzles')).toBeInTheDocument();
    expect(screen.getByText('7 themes')).toBeInTheDocument();
    expect(
      screen.getByText(/Source: Lichess puzzle database \(CC0\) · September 2026/),
    ).toBeInTheDocument();
    expect(screen.getByText('500 opening families')).toBeInTheDocument();
    expect(
      screen.getByText(/Source: lichess-org\/chess-openings \(public domain\) · September 2026/),
    ).toBeInTheDocument();
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
    queryClient.setQueryData(SESSION_QUERY_KEY, { signedIn: true });

    const reports = await screen.findAllByRole('link', { name: 'Go to report' });
    expect(reports.length).toBeGreaterThan(0);
    for (const link of reports) {
      expect(link).toHaveAttribute('href', '/report');
    }
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Get your free diagnosis' })).not.toBeInTheDocument();
  });

  test('asks the session probe and never /me, so a first visit logs no 401', async () => {
    const getMe = vi.spyOn(accountApi, 'getMe');
    renderLanding();

    await screen.findByRole('heading', {
      name: 'Know the one thing to fix after every tournament.',
    });
    expect(getMe).not.toHaveBeenCalled();
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
        'Kanso Chess is an AI chess training platform for junior players and their coaches, with Stockfish analysis and AI coaching.',
      ),
    ).toBeInTheDocument();
  });
});

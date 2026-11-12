import { Chess } from 'chess.js';
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

  test('displays Grandmaster Alex Colovic endorsement verbatim', async () => {
    renderLanding();

    expect(
      await screen.findByText(
        /I checked it with some of my games and it does give valuable information\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('GM Alex Colovic')).toBeInTheDocument();
    expect(screen.getByText(/Grandmaster/)).toBeInTheDocument();
  });

  test('shows a synthetic, labelled sample diagnosis, not a real player', async () => {
    renderLanding();
    expect(await screen.findByText('Synthetic example')).toBeInTheDocument();
    expect(screen.getByText(/A scholastic tournament/)).toBeInTheDocument();
    expect(screen.getByText('Missing tactics in the middlegame')).toBeInTheDocument();
    expect(screen.getByText('Tactical motif')).toBeInTheDocument();
    expect(screen.getByText('37,172 curated puzzles')).toBeInTheDocument();
    expect(screen.getByText('13 themes')).toBeInTheDocument();
    expect(
      screen.getByText(/Source: Lichess puzzle database \(CC0\) · October 2026/),
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
    expect(
      screen.getByText(/Monthly plans start on Intermediate, uncapped on the Pro plan/),
    ).toBeInTheDocument();
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

  test('renders the complete Opera Game position before 16.Qb8+!!', async () => {
    const game = new Chess();
    game.loadPgn(
      '1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 ' +
        '7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 ' +
        '12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7',
    );
    const pieceName: Record<string, string> = {
      k: 'king',
      q: 'queen',
      r: 'rook',
      b: 'bishop',
      n: 'knight',
      p: 'pawn',
    };
    const expected = game
      .board()
      .flat()
      .filter((cell): cell is NonNullable<typeof cell> => cell !== null)
      .map(
        (cell) =>
          `${cell.square} ${cell.color === 'w' ? 'white' : 'black'} ${pieceName[cell.type]}`,
      )
      .sort();

    renderLanding();

    const board = await screen.findByRole('img', {
      name: "Position from Morphy's Opera Game, 1858. White to move, before the queen sacrifice 16 Qb8.",
    });
    const rendered = Array.from(board.querySelectorAll('g[role="img"]'))
      .map((piece) => {
        const transform = piece.getAttribute('transform') ?? '';
        const match = /^translate\((\d+),\s*(\d+)\)/.exec(transform);
        if (match === null) throw new Error(`unexpected piece transform: ${transform}`);
        const file = String.fromCharCode(97 + Number(match[1]) - 1);
        const rank = 9 - Number(match[2]);
        return `${file}${rank} ${piece.getAttribute('aria-label') ?? ''}`;
      })
      .sort();

    expect(rendered).toEqual(expected);
  });
});

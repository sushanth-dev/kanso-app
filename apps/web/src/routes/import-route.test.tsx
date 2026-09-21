import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ME_QUERY_KEY } from '../query-client.ts';
import { ApiRequestError, type Me, type Player } from '../api/account-api.ts';
import type { ImportApi, ImportJob } from '../api/import-api.ts';
import { createAppRouter } from '../router.tsx';
import { ImportScreen, type ImportScreenProps } from './import-route.tsx';
import { track } from '../analytics.ts';

vi.mock('../analytics.ts', () => ({
  track: vi.fn(),
}));

const trackMock = vi.mocked(track);

const ownedPlayerId = '00000000-0000-4000-8000-000000000001';

const ownedPlayer: Player = {
  id: ownedPlayerId,
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
};

const me: Me = {
  userId: 'user-1',
  email: 'player@example.com',
  name: 'Player',
  tier: 'beginner',
  analyticsSuiteAllowed: false,
  player: ownedPlayer,
};

const startImport = vi.fn<ImportApi['startImport']>();

function makeJob(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    playerId: ownedPlayerId,
    source: 'chesscom',
    kind: 'backfill',
    stream: 'online',
    status: 'complete',
    gamesFound: 1,
    gamesImported: 1,
    gamesRejected: 0,
    gamesUndetermined: 0,
    error: null,
    createdAt: '2026-08-14T00:00:00.000Z',
    finishedAt: '2026-08-14T00:00:00.000Z',
    gameIds: ['00000000-0000-4000-8000-0000000000b1'],
    tournament: null,
    ...overrides,
  };
}

function renderScreen(overrides: Partial<ImportScreenProps> = {}) {
  const queryClient = new QueryClient();
  const history = createMemoryHistory();
  const router = createAppRouter({ history, queryClient });
  render(
    <RouterContextProvider router={router}>
      <ImportScreen
        me={me}
        importApi={{ startImport }}
        queryClient={queryClient}
        navigate={vi.fn()}
        {...overrides}
      />
    </RouterContextProvider>,
  );
  return { queryClient };
}

beforeEach(() => {
  startImport.mockReset();
});

describe('ImportScreen', () => {
  test('renders the form and states the import period', () => {
    renderScreen();
    expect(screen.getByRole('heading', { name: 'Import games' })).toBeVisible();
    expect(screen.getByLabelText('Method')).toBeVisible();
    expect(screen.getByLabelText('Username')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Import games' })).toBeVisible();
    expect(screen.getByText('Imports the last 12 months of online games.')).toBeVisible();
  });

  test('mounts the form Card with the reveal-in entrance', () => {
    renderScreen();
    const card = screen.getByRole('heading', { name: 'Import games' }).closest('.reveal-in');
    expect(card).not.toBeNull();
  });

  test('prefills the username from the default when the method is picked', async () => {
    const user = userEvent.setup();
    renderScreen({
      me: {
        ...me,
        player: { ...ownedPlayer, chesscomUsername: 'mina-chess', lichessUsername: 'mina-lichess' },
      },
    });

    expect(screen.getByLabelText('Username')).toHaveValue('mina-chess');

    await user.selectOptions(screen.getByLabelText('Method'), 'lichess');
    expect(screen.getByLabelText('Username')).toHaveValue('mina-lichess');
  });

  test('states the stream per method', async () => {
    const user = userEvent.setup();
    renderScreen();
    expect(screen.getByText('Imports the last 12 months of online games.')).toBeVisible();

    await user.selectOptions(screen.getByLabelText('Method'), 'pgn_upload');
    expect(
      screen.queryByRole('radiogroup', { name: 'Where were these games played?' }),
    ).not.toBeInTheDocument();
  });

  test('rejects an implausible Chess.com username before any request', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByLabelText('Username'), 'a');
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    const errors = await screen.findAllByText('Enter a valid Chess.com username.');
    expect(errors.some((el) => el.id === 'username-status')).toBe(true);
    expect(startImport).not.toHaveBeenCalled();
  });

  test('shows the imported count on a successful import', async () => {
    const user = userEvent.setup();
    startImport.mockResolvedValue(makeJob({ gamesFound: 3, gamesImported: 3 }));
    renderScreen();
    await user.type(screen.getByLabelText('Username'), 'mina123');
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(await screen.findByText('Imported 3 games.')).toBeVisible();
    expect(startImport).toHaveBeenCalledWith({
      source: 'chesscom',
      username: 'mina123',
    });
  });

  test('appends the rejected count to the success message', async () => {
    const user = userEvent.setup();
    startImport.mockResolvedValue(makeJob({ gamesFound: 5, gamesImported: 3, gamesRejected: 2 }));
    renderScreen();
    await user.type(screen.getByLabelText('Username'), 'mina123');
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(
      await screen.findByText('Imported 3 games. 2 games were rejected and not imported.'),
    ).toBeVisible();
  });

  test('tells the player when games need their side before analysis', async () => {
    // ST-095: colourless games are stored but never queued; the success
    // message is where the player learns analysis is waiting on them.
    const user = userEvent.setup();
    startImport.mockResolvedValue(
      makeJob({ gamesFound: 3, gamesImported: 3, gamesUndetermined: 2 }),
    );
    renderScreen();
    await user.type(screen.getByLabelText('Username'), 'mina123');
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(
      await screen.findByText(
        'Imported 3 games. 2 of them could not be tied to your side; open each under Games and pick the colour you played to start its analysis.',
      ),
    ).toBeVisible();
  });

  test('navigates to the report on a username success', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    startImport.mockResolvedValue(makeJob({ gamesFound: 3, gamesImported: 3, stream: 'online' }));
    renderScreen({ navigate });
    await user.type(screen.getByLabelText('Username'), 'mina123');
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(await screen.findByText('Imported 3 games.')).toBeVisible();
    expect(navigate).toHaveBeenCalledWith({
      to: '/report',
      search: { stream: 'online', gameIds: ['00000000-0000-4000-8000-0000000000b1'] },
    });
  });

  test('invalidates the tournament caches on an import success', async () => {
    const user = userEvent.setup();
    startImport.mockResolvedValue(makeJob({ gamesFound: 3, gamesImported: 3, stream: 'online' }));
    const { queryClient } = renderScreen();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    await user.type(screen.getByLabelText('Username'), 'mina123');
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    await screen.findByText('Imported 3 games.');
    const invalidated = invalidate.mock.calls.map(([options]) => options?.queryKey);
    expect(invalidated).toEqual([['games'], ['tournaments'], ['tournament'], ['round-decay']]);
  });

  test('reports no games found for a valid username with an empty period', async () => {
    const user = userEvent.setup();
    startImport.mockResolvedValue(makeJob({ gamesFound: 0, gamesImported: 0 }));
    renderScreen();
    await user.type(screen.getByLabelText('Username'), 'mina123');
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(
      await screen.findByText('No games found for mina123 in the last 12 months.'),
    ).toBeVisible();
  });

  test('reports nothing new when every found game is a duplicate', async () => {
    const user = userEvent.setup();
    startImport.mockResolvedValue(makeJob({ gamesFound: 4, gamesImported: 0 }));
    renderScreen();
    await user.type(screen.getByLabelText('Username'), 'mina123');
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(
      await screen.findByText('Nothing new to import; all 4 games were already in this account.'),
    ).toBeVisible();
  });

  test('reports an unresolved Chess.com username on 422', async () => {
    const user = userEvent.setup();
    startImport.mockRejectedValue(
      new ApiRequestError(422, 'username_not_found', undefined, 'No such account.'),
    );
    renderScreen();
    await user.type(screen.getByLabelText('Username'), 'mina123');
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(await screen.findByText('No Chess.com account by that username.')).toBeVisible();
  });

  test('reports a provider outage on 502', async () => {
    const user = userEvent.setup();
    startImport.mockRejectedValue(
      new ApiRequestError(502, 'upstream_error', undefined, 'Unreachable.'),
    );
    renderScreen();
    await user.type(screen.getByLabelText('Username'), 'mina123');
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(await screen.findByText('Chess.com is unreachable; try again later.')).toBeVisible();
  });

  test('validates a Lichess username against its own charset and imports', async () => {
    const user = userEvent.setup();
    startImport.mockResolvedValue(makeJob({ source: 'lichess', gamesImported: 1 }));
    renderScreen();
    await user.selectOptions(screen.getByLabelText('Method'), 'lichess');
    await user.type(screen.getByLabelText('Username'), 'hi');
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(await screen.findByText('Imported 1 game.')).toBeVisible();
    expect(startImport).toHaveBeenCalledWith({
      source: 'lichess',
      username: 'hi',
    });
  });

  test('ends a six-game tournament upload in the debrief, not a navigation', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const pgn = '[Event "Test"]\n1. e4 e5 1-0';
    startImport.mockResolvedValue(
      makeJob({
        source: 'pgn_upload',
        stream: 'tournament',
        gamesFound: 2,
        gamesImported: 2,
        // ST-096: six or more games in the tournament means a report exists.
        tournament: { id: '00000000-0000-4000-8000-0000000000c1', gameCount: 7 },
      }),
    );
    renderScreen({ navigate });
    await user.selectOptions(screen.getByLabelText('Method'), 'pgn_upload');
    await user.upload(
      screen.getByLabelText('PGN file', { selector: 'input' }),
      new File([pgn], 'games.pgn', { type: 'application/x-chess-pgn' }),
    );
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(await screen.findByText('Imported 2 games.')).toBeVisible();
    expect(startImport).toHaveBeenCalledWith({
      source: 'pgn_upload',
      pgn,
      stream: 'tournament',
    });
    // ST-115: the import ends in the debrief, led by one primary action.
    expect(navigate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Start the debrief' }));
    expect(navigate).toHaveBeenCalledWith({
      to: '/debrief',
      search: {
        gameIds: ['00000000-0000-4000-8000-0000000000b1'],
        tournamentId: '00000000-0000-4000-8000-0000000000c1',
      },
    });
  });

  test('hands an under-threshold tournament upload to the debrief with its game', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const pgn = '[Event "Test"]\n1. e4 e5 1-0';
    startImport.mockResolvedValue(
      makeJob({
        source: 'pgn_upload',
        stream: 'tournament',
        gamesFound: 2,
        gamesImported: 2,
        tournament: { id: '00000000-0000-4000-8000-0000000000c1', gameCount: 5 },
      }),
    );
    renderScreen({ navigate });
    await user.selectOptions(screen.getByLabelText('Method'), 'pgn_upload');
    await user.upload(
      screen.getByLabelText('PGN file', { selector: 'input' }),
      new File([pgn], 'games.pgn', { type: 'application/x-chess-pgn' }),
    );
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(await screen.findByText('Imported 2 games.')).toBeVisible();
    // ST-115: no navigation on completion; the batch rides the CTA, and the
    // game id rides only because the old landing was the game review.
    expect(navigate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Start the debrief' }));
    expect(navigate).toHaveBeenCalledWith({
      to: '/debrief',
      search: {
        gameIds: ['00000000-0000-4000-8000-0000000000b1'],
        tournamentId: '00000000-0000-4000-8000-0000000000c1',
        gameId: '00000000-0000-4000-8000-0000000000b1',
      },
    });
  });

  test('imports a PGN file dropped on the upload target', async () => {
    const user = userEvent.setup();
    const pgn = '[Event "Test"]\n1. e4 e5 1-0';
    startImport.mockResolvedValue(
      makeJob({ source: 'pgn_upload', stream: 'tournament', gamesFound: 1, gamesImported: 1 }),
    );
    renderScreen();
    await user.selectOptions(screen.getByLabelText('Method'), 'pgn_upload');

    const dropTarget = screen.getByRole('button', { name: 'PGN file' });
    const file = new File([pgn], 'games.pgn', { type: 'application/x-chess-pgn' });
    fireEvent.drop(dropTarget, { dataTransfer: { files: [file] } });

    expect(await screen.findByText('games.pgn')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(startImport).toHaveBeenCalledWith({
      source: 'pgn_upload',
      pgn,
      stream: 'tournament',
    });
  });

  test('requires a PGN file before any request', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.selectOptions(screen.getByLabelText('Method'), 'pgn_upload');
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect((await screen.findAllByText('Choose a PGN file.')).length).toBeGreaterThan(0);
    expect(startImport).not.toHaveBeenCalled();
  });

  test('names the unparseable game on an invalid_pgn upload', async () => {
    const user = userEvent.setup();
    startImport.mockRejectedValue(
      new ApiRequestError(
        400,
        'invalid_pgn',
        [{ path: 'game 3', message: 'missing result header' }],
        'The upload contains a game that could not be parsed.',
      ),
    );
    renderScreen();
    await user.selectOptions(screen.getByLabelText('Method'), 'pgn_upload');
    await user.upload(
      screen.getByLabelText('PGN file', { selector: 'input' }),
      new File(['[Event "Test"]\n1. e4'], 'games.pgn', { type: 'application/x-chess-pgn' }),
    );
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(
      await screen.findByText('The upload contains a game that could not be parsed.'),
    ).toBeVisible();
    expect(screen.getByText('game 3: missing result header')).toBeVisible();
  });

  test('renders the daily import cap message on 429', async () => {
    const user = userEvent.setup();
    startImport.mockRejectedValue(
      new ApiRequestError(
        429,
        'daily_import_cap',
        undefined,
        'Daily online import cap reached. Try again tomorrow.',
      ),
    );
    renderScreen();
    await user.type(screen.getByLabelText('Username'), 'mina123');
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(
      await screen.findByText('Daily online import cap reached. Try again tomorrow.'),
    ).toBeVisible();
  });

  test('fires game_imported with counts, never game or child data', async () => {
    const user = userEvent.setup();
    startImport.mockResolvedValue(makeJob({ gamesFound: 3, gamesImported: 3 }));
    renderScreen();
    await user.type(screen.getByLabelText('Username'), 'mina123');
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    await screen.findByText('Imported 3 games.');
    expect(trackMock).toHaveBeenCalledWith('game_imported', {
      source: 'chesscom',
      gamesFound: 3,
      gamesImported: 3,
    });
  });

  test('renders the too-many-games refusal from the API', async () => {
    const user = userEvent.setup();
    startImport.mockRejectedValue(
      new ApiRequestError(
        422,
        'too_many_games',
        undefined,
        'That upload carries more games than an import may hold.',
      ),
    );
    renderScreen();

    await user.type(screen.getByLabelText('Username'), 'mina123');
    await user.click(screen.getByRole('button', { name: 'Import games' }));

    expect(
      await screen.findByText('That upload carries more games than an import may hold.'),
    ).toBeVisible();
  });

  test('a dead session clears the me cache and sends the player to sign-in', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    startImport.mockRejectedValue(
      new ApiRequestError(401, 'unauthorized', undefined, 'No session.'),
    );
    const { queryClient } = renderScreen({ navigate });
    queryClient.setQueryData(ME_QUERY_KEY, me);

    await user.type(screen.getByLabelText('Username'), 'mina123');
    await user.click(screen.getByRole('button', { name: 'Import games' }));

    await waitFor(() => {
      expect(queryClient.getQueryData(ME_QUERY_KEY)).toBeUndefined();
      expect(navigate).toHaveBeenCalledWith({ to: '/sign-in' });
    });
  });

  test('refuses an import that belongs to another account on 403', async () => {
    const user = userEvent.setup();
    startImport.mockRejectedValue(
      new ApiRequestError(403, 'forbidden', undefined, 'Not your player.'),
    );
    renderScreen();

    await user.type(screen.getByLabelText('Username'), 'mina123');
    await user.click(screen.getByRole('button', { name: 'Import games' }));

    expect(
      await screen.findByText('This player cannot be imported from this account.'),
    ).toBeVisible();
  });

  test('offers a retry when the import fails unexpectedly', async () => {
    const user = userEvent.setup();
    startImport.mockRejectedValue(new Error('socket hang up'));
    renderScreen();

    await user.type(screen.getByLabelText('Username'), 'mina123');
    await user.click(screen.getByRole('button', { name: 'Import games' }));

    expect(await screen.findByText('The import failed. Please try again.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Import games' })).toBeEnabled();
  });

  test('reports an unresolved Lichess username on 422', async () => {
    const user = userEvent.setup();
    startImport.mockRejectedValue(
      new ApiRequestError(422, 'username_not_found', undefined, 'No such account.'),
    );
    renderScreen();

    await user.selectOptions(screen.getByLabelText('Method'), 'lichess');
    await user.type(screen.getByLabelText('Username'), 'ghost');
    await user.click(screen.getByRole('button', { name: 'Import games' }));

    expect(await screen.findByText('No Lichess account by that username.')).toBeVisible();
  });

  test('reports nothing new in the singular', async () => {
    const user = userEvent.setup();
    startImport.mockResolvedValue(makeJob({ gamesFound: 1, gamesImported: 0 }));
    renderScreen();

    await user.type(screen.getByLabelText('Username'), 'mina123');
    await user.click(screen.getByRole('button', { name: 'Import games' }));

    expect(
      await screen.findByText('Nothing new to import; all 1 game was already in this account.'),
    ).toBeVisible();
  });

  test('reports one import and one rejection in the singular', async () => {
    const user = userEvent.setup();
    startImport.mockResolvedValue(makeJob({ gamesFound: 2, gamesImported: 1, gamesRejected: 1 }));
    renderScreen();

    await user.type(screen.getByLabelText('Username'), 'mina123');
    await user.click(screen.getByRole('button', { name: 'Import games' }));

    expect(
      await screen.findByText('Imported 1 game. 1 game was rejected and not imported.'),
    ).toBeVisible();
  });

  test('sends a tournament batch with no tournament to the debrief without an id', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const pgn = '[Event "Test"]\n1. e4 e5 1-0';
    startImport.mockResolvedValue(
      makeJob({
        source: 'pgn_upload',
        stream: 'tournament',
        gamesFound: 1,
        gamesImported: 1,
        tournament: null,
      }),
    );
    renderScreen({ navigate });
    await user.selectOptions(screen.getByLabelText('Method'), 'pgn_upload');
    await user.upload(
      screen.getByLabelText('PGN file', { selector: 'input' }),
      new File([pgn], 'games.pgn', { type: 'application/x-chess-pgn' }),
    );
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(await screen.findByText('Imported 1 game.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Start the debrief' }));
    expect(navigate).toHaveBeenCalledWith({
      to: '/debrief',
      search: {
        gameIds: ['00000000-0000-4000-8000-0000000000b1'],
        gameId: '00000000-0000-4000-8000-0000000000b1',
      },
    });
  });

  test('prefills the Lichess username and clears a field error when switching methods', async () => {
    const user = userEvent.setup();
    renderScreen({
      me: {
        ...me,
        player: { ...ownedPlayer, lichessUsername: 'mina-lichess' },
      },
    });

    // An implausible Chess.com username leaves an error behind.
    await user.type(screen.getByLabelText('Username'), 'a');
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(await screen.findByText('Enter a valid Chess.com username.')).toBeVisible();

    await user.selectOptions(screen.getByLabelText('Method'), 'lichess');
    expect(screen.getByLabelText('Username')).toHaveValue('mina-lichess');
    // The field's own error status clears with the method switch; the
    // screen-reader live region keeps an announcer copy, so the field is
    // what asserts.
    expect(screen.getByLabelText('Username')).not.toHaveAttribute('aria-invalid');
  });

  test('says the season import is running while waiting', async () => {
    const user = userEvent.setup();
    const { promise, resolve } = Promise.withResolvers<ImportJob>();
    startImport.mockReturnValue(promise);
    renderScreen();

    await user.type(screen.getByLabelText('Username'), 'mina123');
    await user.click(screen.getByRole('button', { name: 'Import games' }));

    expect(
      await screen.findByText("Importing Mina's season... this usually takes about a minute."),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Importing...' })).toBeDisabled();

    resolve(makeJob({ gamesImported: 1 }));
    expect(await screen.findByText('Imported 1 game.')).toBeVisible();
  });
});

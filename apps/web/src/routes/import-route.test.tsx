import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
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

  test('offers all four import methods in order', () => {
    renderScreen();
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual([
      'Chess.com username',
      'Lichess username',
      'PGN upload',
      'Tournament by name',
    ]);
  });

  test('states the stream per method', async () => {
    const user = userEvent.setup();
    renderScreen();
    expect(screen.getByText('Imports the last 12 months of online games.')).toBeVisible();

    await user.selectOptions(screen.getByLabelText('Method'), 'pgn_upload');
    expect(screen.getByRole('group', { name: 'Where were these games played?' })).toBeVisible();

    await user.selectOptions(screen.getByLabelText('Method'), 'uscf');
    expect(screen.getByText('Imports tournament results, not moves.')).toBeVisible();
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

  test('navigates to the report on a username success', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    startImport.mockResolvedValue(makeJob({ gamesFound: 3, gamesImported: 3, stream: 'online' }));
    renderScreen({ navigate });
    await user.type(screen.getByLabelText('Username'), 'mina123');
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(await screen.findByText('Imported 3 games.')).toBeVisible();
    expect(navigate).toHaveBeenCalledWith({
      to: '/account/report',
      search: { stream: 'online' },
    });
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

  test('imports a PGN upload, states the chosen stream, and navigates to the report', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const pgn = '[Event "Test"]\n1. e4 e5 1-0';
    startImport.mockResolvedValue(
      makeJob({ source: 'pgn_upload', stream: 'online', gamesFound: 2, gamesImported: 2 }),
    );
    renderScreen({ navigate });
    await user.selectOptions(screen.getByLabelText('Method'), 'pgn_upload');
    await user.upload(
      screen.getByLabelText('PGN file'),
      new File([pgn], 'games.pgn', { type: 'application/x-chess-pgn' }),
    );
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(await screen.findByText('Imported 2 games.')).toBeVisible();
    expect(startImport).toHaveBeenCalledWith({
      source: 'pgn_upload',
      pgn,
      stream: 'online',
    });
    expect(navigate).toHaveBeenCalledWith({
      to: '/account/report',
      search: { stream: 'online' },
    });
  });

  test('imports a PGN file dropped on the upload target', async () => {
    const user = userEvent.setup();
    const pgn = '[Event "Test"]\n1. e4 e5 1-0';
    startImport.mockResolvedValue(
      makeJob({ source: 'pgn_upload', stream: 'online', gamesFound: 1, gamesImported: 1 }),
    );
    renderScreen();
    await user.selectOptions(screen.getByLabelText('Method'), 'pgn_upload');

    const dropTarget = screen.getByRole('button', { name: /drop a pgn file here/i });
    const file = new File([pgn], 'games.pgn', { type: 'application/x-chess-pgn' });
    fireEvent.drop(dropTarget, { dataTransfer: { files: [file] } });

    expect(await screen.findByText('games.pgn')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(startImport).toHaveBeenCalledWith({
      source: 'pgn_upload',
      pgn,
      stream: 'online',
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
      screen.getByLabelText('PGN file'),
      new File(['[Event "Test"]\n1. e4'], 'games.pgn', { type: 'application/x-chess-pgn' }),
    );
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(
      await screen.findByText('The upload contains a game that could not be parsed.'),
    ).toBeVisible();
    expect(screen.getByText('game 3: missing result header')).toBeVisible();
  });

  test('imports a tournament, notes results carry no moves, and does not navigate', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    startImport.mockResolvedValue(
      makeJob({ source: 'uscf', stream: 'tournament', gamesFound: 3, gamesImported: 3 }),
    );
    renderScreen({ navigate });
    await user.selectOptions(screen.getByLabelText('Method'), 'uscf');
    await user.type(screen.getByLabelText('Tournament name'), 'State Champs');
    expect(screen.getByLabelText('Player name')).toHaveValue('Mina');
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(await screen.findByText('Imported 3 games.')).toBeVisible();
    expect(
      screen.getByText('These games carry results, not moves, so no analysis follows.'),
    ).toBeVisible();
    expect(startImport).toHaveBeenCalledWith({
      source: 'uscf',
      tournamentName: 'State Champs',
      playerName: 'Mina',
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  test('reports no games found for a tournament with an empty crosstable', async () => {
    const user = userEvent.setup();
    startImport.mockResolvedValue(
      makeJob({ source: 'uscf', stream: 'tournament', gamesFound: 0, gamesImported: 0 }),
    );
    renderScreen();
    await user.selectOptions(screen.getByLabelText('Method'), 'uscf');
    await user.type(screen.getByLabelText('Tournament name'), 'State Champs');
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(await screen.findByText('No games found for Mina in State Champs.')).toBeVisible();
  });

  test('reports an unknown tournament name on 422', async () => {
    const user = userEvent.setup();
    startImport.mockRejectedValue(
      new ApiRequestError(
        422,
        'tournament_not_found',
        undefined,
        'No USCF tournament found by that name.',
      ),
    );
    renderScreen();
    await user.selectOptions(screen.getByLabelText('Method'), 'uscf');
    await user.type(screen.getByLabelText('Tournament name'), 'Not A Real Event');
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(
      await screen.findByText('No USCF tournament found by the name "Not A Real Event".'),
    ).toBeVisible();
  });

  test('renders the name-mismatch detail verbatim on 422', async () => {
    const user = userEvent.setup();
    startImport.mockRejectedValue(
      new ApiRequestError(
        422,
        'name_mismatch',
        undefined,
        'This tournament lists a Kamabathula but not Sushanth Kamabathula; check the spelling.',
      ),
    );
    renderScreen();
    await user.selectOptions(screen.getByLabelText('Method'), 'uscf');
    await user.type(screen.getByLabelText('Tournament name'), 'State Champs');
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(
      await screen.findByText(
        'This tournament lists a Kamabathula but not Sushanth Kamabathula; check the spelling.',
      ),
    ).toBeVisible();
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
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError, type Me, type Player } from '../api/account-api.ts';
import type { ImportApi, ImportJob } from '../api/import-api.ts';
import { createAppRouter } from '../router.tsx';
import { ImportScreen, type ImportScreenProps } from './import-route.tsx';

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
  createdAt: '2026-08-14T00:00:00.000Z',
};

const me: Me = {
  userId: 'user-1',
  email: 'player@example.com',
  name: 'Player',
  tier: 'free',
  players: [ownedPlayer],
  guardedPlayers: [],
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
        playerId={ownedPlayerId}
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
    expect(screen.getByLabelText('Provider')).toBeVisible();
    expect(screen.getByLabelText('Username')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Import games' })).toBeVisible();
    expect(screen.getByText('Imports the last 12 months of online games.')).toBeVisible();
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
    expect(startImport).toHaveBeenCalledWith(ownedPlayerId, {
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
    await user.selectOptions(screen.getByLabelText('Provider'), 'lichess');
    await user.type(screen.getByLabelText('Username'), 'hi');
    await user.click(screen.getByRole('button', { name: 'Import games' }));
    expect(await screen.findByText('Imported 1 game.')).toBeVisible();
    expect(startImport).toHaveBeenCalledWith(ownedPlayerId, {
      source: 'lichess',
      username: 'hi',
    });
  });
});

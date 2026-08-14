import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AccountApi, Me, Player } from '../api/account-api.ts';
import { ApiRequestError } from '../api/account-api.ts';
import { ME_QUERY_KEY } from '../query-client.ts';
import { createAppRouter } from '../router.tsx';
import type { NavigateTo } from './auth-routes.tsx';
import { playerBody, PlayerFormScreen } from './player-routes.tsx';

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const playerId = '00000000-0000-4000-8000-000000000001';

function player(overrides: Partial<Player> = {}): Player {
  return {
    id: playerId,
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
    ...overrides,
  };
}

function meFixture(overrides: Partial<Me> = {}): Me {
  return {
    userId: 'user-1',
    email: 'player@example.com',
    name: 'Player',
    tier: 'free',
    players: [player()],
    guardedPlayers: [],
    ...overrides,
  };
}

function accountApi(overrides: Partial<AccountApi> = {}): AccountApi {
  return {
    getMe: vi.fn(),
    createPlayer: vi.fn(),
    updatePlayer: vi.fn(),
    attachGuardian: vi.fn(),
    ...overrides,
  };
}

function renderScreen({
  mode = 'create',
  me = meFixture(),
  playerId: id,
  api = accountApi(),
  navigate = vi.fn(),
}: {
  mode?: 'create' | 'edit';
  me?: Me;
  playerId?: string;
  api?: AccountApi;
  navigate?: NavigateTo;
} = {}) {
  const user = userEvent.setup();
  const queryClient = new QueryClient();
  const history = createMemoryHistory();
  const router = createAppRouter({ history, queryClient });
  render(
    <RouterContextProvider router={router}>
      <PlayerFormScreen
        mode={mode}
        me={me}
        playerId={id}
        accountApi={api}
        queryClient={queryClient}
        navigate={navigate}
      />
    </RouterContextProvider>,
  );
  return { user, queryClient };
}

describe('playerBody', () => {
  test('trims displayName and omits empty optional values', () => {
    expect(
      playerBody(formData({ displayName: '  Mina  ', birthYear: '', fideRating: '' })),
    ).toEqual({ displayName: 'Mina' });
  });

  test('parses numeric fields to integers', () => {
    expect(
      playerBody(formData({ displayName: 'Mina', birthYear: '2013', fideRating: '1875' })),
    ).toEqual({ displayName: 'Mina', birthYear: 2013, fideRating: 1875 });
  });

  test('ignores non-allowlisted fields like ownerUserId', () => {
    expect(
      JSON.stringify(playerBody(formData({ displayName: 'Mina', ownerUserId: 'attacker' }))),
    ).not.toContain('owner');
  });

  test('rejects a non-numeric birthYear', () => {
    expect(() => playerBody(formData({ displayName: 'Mina', birthYear: 'not-a-number' }))).toThrow(
      'Birth year must be a number.',
    );
  });
});

describe('PlayerFormScreen create', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('submits the allowlisted body', async () => {
    const createPlayer = vi.fn().mockResolvedValue(player());
    const api = accountApi({ createPlayer });
    const { user } = renderScreen({ api });

    await user.type(screen.getByLabelText('Display name'), 'Mina');
    await user.type(screen.getByLabelText('Birth year'), '2013');
    await user.click(screen.getByRole('button', { name: 'Create player' }));

    await waitFor(() =>
      expect(createPlayer).toHaveBeenCalledWith({ displayName: 'Mina', birthYear: 2013 }),
    );
  });

  test('renders a 400 issue with path birthYear beside Birth year and preserves values', async () => {
    const createPlayer = vi
      .fn()
      .mockRejectedValue(
        new ApiRequestError(
          400,
          'validation_failed',
          [{ path: 'birthYear', message: 'Birth year must be between 1900 and 2100.' }],
          'Invalid.',
        ),
      );
    const { user } = renderScreen({ api: accountApi({ createPlayer }) });

    await user.type(screen.getByLabelText('Display name'), 'Mina');
    await user.type(screen.getByLabelText('Birth year'), '2013');
    await user.click(screen.getByRole('button', { name: 'Create player' }));

    expect(await screen.findByText('Birth year must be between 1900 and 2100.')).toBeVisible();
    expect(screen.getByLabelText('Display name')).toHaveValue('Mina');
  });

  test('does not map field issues for a non-400 status', async () => {
    const createPlayer = vi
      .fn()
      .mockRejectedValue(
        new ApiRequestError(
          409,
          'conflict',
          [{ path: 'birthYear', message: 'SERVER DETAIL SHOULD NOT LEAK' }],
          'Conflict.',
        ),
      );
    const { user } = renderScreen({ api: accountApi({ createPlayer }) });

    await user.type(screen.getByLabelText('Display name'), 'Mina');
    await user.click(screen.getByRole('button', { name: 'Create player' }));

    expect(
      await screen.findByText('The player could not be saved. Please try again.'),
    ).toBeVisible();
    expect(screen.queryByText('SERVER DETAIL SHOULD NOT LEAK')).not.toBeInTheDocument();
  });

  test('navigates to /sign-in on 401', async () => {
    const createPlayer = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(401, 'unauthorized', undefined, 'No session.'));
    const navigate = vi.fn();
    const { user } = renderScreen({ api: accountApi({ createPlayer }), navigate });

    await user.type(screen.getByLabelText('Display name'), 'Mina');
    await user.click(screen.getByRole('button', { name: 'Create player' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/sign-in' }));
  });

  test('renders the 403 copy and preserves values', async () => {
    const createPlayer = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(403, 'forbidden', undefined, 'Not yours.'));
    const { user } = renderScreen({ api: accountApi({ createPlayer }) });

    await user.type(screen.getByLabelText('Display name'), 'Mina');
    await user.click(screen.getByRole('button', { name: 'Create player' }));

    expect(
      await screen.findByText('This player cannot be changed from this account.'),
    ).toBeVisible();
    expect(screen.getByLabelText('Display name')).toHaveValue('Mina');
  });

  test('keeps submit disabled and blocks duplicate mutations until invalidation resolves', async () => {
    const createPlayer = vi.fn().mockResolvedValue(player());
    let resolveInvalidate: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      resolveInvalidate = resolve;
    });
    const { user, queryClient } = renderScreen({ api: accountApi({ createPlayer }) });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(pending);

    await user.type(screen.getByLabelText('Display name'), 'Mina');
    await user.click(screen.getByRole('button', { name: 'Create player' }));

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ME_QUERY_KEY }));
    const button = screen.getByRole('button', { name: 'Create player' });
    expect(button).toBeDisabled();
    expect(createPlayer).toHaveBeenCalledTimes(1);

    // The disabled submit button cannot fire a second mutation.
    await user.click(button).catch(() => {});
    expect(createPlayer).toHaveBeenCalledTimes(1);

    resolveInvalidate();
    await waitFor(() => expect(invalidateSpy.mock.results[0]?.value).toBe(pending));
  });

  test('announces via role=status, invalidates, then navigates only after invalidation resolves', async () => {
    const createPlayer = vi.fn().mockResolvedValue(player());
    const navigate = vi.fn();
    let resolveInvalidate: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      resolveInvalidate = resolve;
    });
    const { user, queryClient } = renderScreen({ api: accountApi({ createPlayer }), navigate });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(pending);

    await user.type(screen.getByLabelText('Display name'), 'Mina');
    await user.click(screen.getByRole('button', { name: 'Create player' }));

    await waitFor(() => {
      expect(screen.getByText('Player saved.')).toHaveAttribute('role', 'status');
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ME_QUERY_KEY });
      expect(navigate).not.toHaveBeenCalled();
    });

    resolveInvalidate();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/account' }));
  });

  test('Cancel is a link to /account', () => {
    renderScreen();
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/account');
  });
});

describe('PlayerFormScreen edit', () => {
  test('pre-fills an owned player', () => {
    renderScreen({ mode: 'edit', me: meFixture(), playerId });
    expect(screen.getByLabelText('Display name')).toHaveValue('Mina');
    expect(screen.getByLabelText('Birth year')).toHaveValue(2013);
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AccountApi, Me, Player } from '../api/account-api.ts';
import { ApiRequestError } from '../api/account-api.ts';
import { PageFrame } from '../components/page-frame.tsx';
import { StatusMessageProvider } from '../components/status-message.tsx';
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
    tier: 'beginner',
    player: player(),
    ...overrides,
  };
}

function accountApi(overrides: Partial<AccountApi> = {}): AccountApi {
  return {
    getMe: vi.fn(),
    updateMe: vi.fn(),
    ...overrides,
  };
}

function renderScreen({
  me = meFixture(),
  api = accountApi(),
  navigate = vi.fn(),
}: {
  me?: Me;
  api?: AccountApi;
  navigate?: NavigateTo;
} = {}) {
  const user = userEvent.setup();
  const queryClient = new QueryClient();
  const history = createMemoryHistory();
  const router = createAppRouter({ history, queryClient });
  render(
    <RouterContextProvider router={router}>
      <StatusMessageProvider>
        <PageFrame>
          <PlayerFormScreen
            me={me}
            accountApi={api}
            queryClient={queryClient}
            navigate={navigate}
          />
        </PageFrame>
      </StatusMessageProvider>
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

describe('PlayerFormScreen', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('submits the allowlisted body', async () => {
    const updateMe = vi.fn().mockResolvedValue(player());
    const api = accountApi({ updateMe });
    const { user } = renderScreen({ api });

    await user.clear(screen.getByLabelText('Display name'));
    await user.type(screen.getByLabelText('Display name'), 'Mina');
    await user.clear(screen.getByLabelText('Birth year'));
    await user.type(screen.getByLabelText('Birth year'), '2013');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(updateMe).toHaveBeenCalledWith({ displayName: 'Mina', birthYear: 2013 }),
    );
  });

  test('renders a 400 issue with path birthYear beside Birth year and preserves values', async () => {
    const updateMe = vi
      .fn()
      .mockRejectedValue(
        new ApiRequestError(
          400,
          'validation_failed',
          [{ path: 'birthYear', message: 'Birth year must be between 1900 and 2100.' }],
          'Invalid.',
        ),
      );
    const { user } = renderScreen({ api: accountApi({ updateMe }) });

    await user.clear(screen.getByLabelText('Display name'));
    await user.type(screen.getByLabelText('Display name'), 'Mina');
    await user.clear(screen.getByLabelText('Birth year'));
    await user.type(screen.getByLabelText('Birth year'), '2013');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      (await screen.findAllByText('Birth year must be between 1900 and 2100.')).length,
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText('Display name')).toHaveValue('Mina');
    expect(screen.getByLabelText('Birth year')).toHaveValue(2013);
  });

  test('does not map field issues for a non-400 status', async () => {
    const updateMe = vi
      .fn()
      .mockRejectedValue(
        new ApiRequestError(
          409,
          'conflict',
          [{ path: 'birthYear', message: 'SERVER DETAIL SHOULD NOT LEAK' }],
          'Conflict.',
        ),
      );
    const { user } = renderScreen({ api: accountApi({ updateMe }) });

    await user.clear(screen.getByLabelText('Display name'));
    await user.type(screen.getByLabelText('Display name'), 'Mina');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByText('The player could not be saved. Please try again.'),
    ).toBeVisible();
    expect(screen.queryByText('SERVER DETAIL SHOULD NOT LEAK')).not.toBeInTheDocument();
  });

  test('navigates to /sign-in on 401', async () => {
    const updateMe = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(401, 'unauthorized', undefined, 'No session.'));
    const navigate = vi.fn();
    const { user, queryClient } = renderScreen({ api: accountApi({ updateMe }), navigate });
    queryClient.setQueryData(ME_QUERY_KEY, meFixture());
    const removeSpy = vi.spyOn(queryClient, 'removeQueries');

    await user.clear(screen.getByLabelText('Display name'));
    await user.type(screen.getByLabelText('Display name'), 'Mina');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/sign-in' }));
    expect(queryClient.getQueryData(ME_QUERY_KEY)).toBeUndefined();
    expect(removeSpy.mock.invocationCallOrder[0]).toBeLessThan(
      navigate.mock.invocationCallOrder[0] ?? 0,
    );
  });

  test('renders the 404 copy and preserves values', async () => {
    const updateMe = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(404, 'not_found', undefined, 'No such player.'));
    const { user } = renderScreen({ api: accountApi({ updateMe }) });

    await user.clear(screen.getByLabelText('Display name'));
    await user.type(screen.getByLabelText('Display name'), 'Mina');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('No player for this account.')).toBeVisible();
    expect(screen.getByLabelText('Display name')).toHaveValue('Mina');
  });

  test('keeps submit disabled and blocks duplicate mutations until invalidation resolves', async () => {
    const updateMe = vi.fn().mockResolvedValue(player());
    let resolveInvalidate: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      resolveInvalidate = resolve;
    });
    const { user, queryClient } = renderScreen({ api: accountApi({ updateMe }) });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(pending);

    await user.clear(screen.getByLabelText('Display name'));
    await user.type(screen.getByLabelText('Display name'), 'Mina');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ME_QUERY_KEY }));
    const button = screen.getByRole('button', { name: 'Save changes' });
    expect(button).toBeDisabled();
    expect(updateMe).toHaveBeenCalledTimes(1);

    // The disabled submit button cannot fire a second mutation.
    await user.click(button).catch(() => {});
    expect(updateMe).toHaveBeenCalledTimes(1);

    resolveInvalidate();
    await waitFor(() => expect(invalidateSpy.mock.results[0]?.value).toBe(pending));
  });

  test('invalidates, then navigates only after invalidation resolves', async () => {
    const updateMe = vi.fn().mockResolvedValue(player());
    const navigate = vi.fn();
    let resolveInvalidate: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      resolveInvalidate = resolve;
    });
    const { user, queryClient } = renderScreen({ api: accountApi({ updateMe }), navigate });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(pending);

    await user.clear(screen.getByLabelText('Display name'));
    await user.type(screen.getByLabelText('Display name'), 'Mina');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
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

  test('pre-fills the account player', () => {
    renderScreen();
    expect(screen.getByLabelText('Display name')).toHaveValue('Mina');
    expect(screen.getByLabelText('Birth year')).toHaveValue(2013);
  });
});

describe('PlayerFormScreen consent and grouping', () => {
  const consent =
    'Consent is confirmed from the guardian email entered at sign-up. This form records a birth year, never a full date of birth.';

  test('renders the consent line and the three grouped legends', () => {
    renderScreen();
    expect(screen.getByText(consent)).toBeVisible();
    expect(screen.getByRole('group', { name: 'Identity' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Federation' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Platforms' })).toBeInTheDocument();
  });
});

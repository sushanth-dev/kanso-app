import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AccountApi, Me, Player } from '../api/account-api.ts';
import { ApiRequestError } from '../api/account-api.ts';
import { ME_QUERY_KEY } from '../query-client.ts';
import type { NavigateTo } from './auth-routes.tsx';
import { GuardianScreen } from './guardian-route.tsx';

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
    guardedPlayers: [player({ id: '00000000-0000-4000-8000-000000000002', displayName: 'Theo' })],
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

function renderGuardian({
  me = meFixture(),
  id = playerId,
  api = accountApi(),
  navigate = vi.fn(),
}: {
  me?: Me;
  id?: string;
  api?: AccountApi;
  navigate?: NavigateTo;
} = {}) {
  const user = userEvent.setup();
  const queryClient = new QueryClient();
  render(
    <GuardianScreen
      me={me}
      playerId={id}
      accountApi={api}
      queryClient={queryClient}
      navigate={navigate}
    />,
  );
  return { user, queryClient };
}

describe('GuardianScreen', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('shows the owned player name', () => {
    renderGuardian();
    expect(screen.getByText('Mina')).toBeVisible();
  });

  test('guardian email is required with email autocomplete', () => {
    renderGuardian();
    expect(screen.getByLabelText('Guardian email')).toBeRequired();
    expect(screen.getByLabelText('Guardian email')).toHaveAttribute('autocomplete', 'email');
  });

  test('relationship is optional and max 40', () => {
    renderGuardian();
    expect(screen.getByLabelText('Relationship')).not.toBeRequired();
    expect(screen.getByLabelText('Relationship')).toHaveAttribute('maxlength', '40');
  });

  test('submits exactly the guardian body, omitting relationship when empty', async () => {
    const attachGuardian = vi.fn().mockResolvedValue(undefined);
    const { user } = renderGuardian({ api: accountApi({ attachGuardian }) });

    await user.type(screen.getByLabelText('Guardian email'), 'adult@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));

    await waitFor(() =>
      expect(attachGuardian).toHaveBeenCalledWith(playerId, { guardianEmail: 'adult@example.com' }),
    );
  });

  test('includes relationship when provided', async () => {
    const attachGuardian = vi.fn().mockResolvedValue(undefined);
    const { user } = renderGuardian({ api: accountApi({ attachGuardian }) });

    await user.type(screen.getByLabelText('Guardian email'), 'adult@example.com');
    await user.type(screen.getByLabelText('Relationship'), 'Parent');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));

    await waitFor(() =>
      expect(attachGuardian).toHaveBeenCalledWith(playerId, {
        guardianEmail: 'adult@example.com',
        relationship: 'Parent',
      }),
    );
  });
  test('navigates to /sign-in on 401', async () => {
    const attachGuardian = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(401, 'unauthorized', undefined, 'No session.'));
    const navigate = vi.fn();
    const { user } = renderGuardian({ api: accountApi({ attachGuardian }), navigate });

    await user.type(screen.getByLabelText('Guardian email'), 'adult@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/sign-in' }));
  });

  test('renders the 409 copy and preserves the typed email', async () => {
    const attachGuardian = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(409, 'conflict', undefined, 'Already attached.'));
    const { user } = renderGuardian({ api: accountApi({ attachGuardian }) });

    await user.type(screen.getByLabelText('Guardian email'), 'adult@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));

    expect(await screen.findByText('That guardian is already attached.')).toBeVisible();
  });

  test('success announces, invalidates me, and navigates to /account', async () => {
    const attachGuardian = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn();
    const { user, queryClient } = renderGuardian({
      api: accountApi({ attachGuardian }),
      navigate,
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);

    await user.type(screen.getByLabelText('Guardian email'), 'adult@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));

    await waitFor(() => {
      expect(screen.getByText('Guardian invitation sent.')).toBeVisible();
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ME_QUERY_KEY });
      expect(navigate).toHaveBeenCalledWith({ to: '/account' });
    });
  });

  test('Cancel returns to /account', async () => {
    const navigate = vi.fn();
    const { user } = renderGuardian({ navigate });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/account' }));
  });
});

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
  const history = createMemoryHistory();
  const router = createAppRouter({ history, queryClient });
  render(
    <RouterContextProvider router={router}>
      <StatusMessageProvider>
        <PageFrame>
          <GuardianScreen
            me={me}
            playerId={id}
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
    expect(screen.getByLabelText('Guardian email')).toHaveValue('adult@example.com');
  });

  test('preserves values after a generic failure', async () => {
    const attachGuardian = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(500, 'server_error', undefined, 'Boom.'));
    const { user } = renderGuardian({ api: accountApi({ attachGuardian }) });

    await user.type(screen.getByLabelText('Guardian email'), 'adult@example.com');
    await user.type(screen.getByLabelText('Relationship'), 'Parent');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));

    expect(
      await screen.findByText('The guardian could not be added. Please try again.'),
    ).toBeVisible();
    expect(screen.getByLabelText('Guardian email')).toHaveValue('adult@example.com');
    expect(screen.getByLabelText('Relationship')).toHaveValue('Parent');
  });

  test('keeps submit disabled and blocks duplicate mutations until invalidation resolves', async () => {
    const attachGuardian = vi.fn().mockResolvedValue(undefined);
    let resolveInvalidate: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      resolveInvalidate = resolve;
    });
    const { user, queryClient } = renderGuardian({ api: accountApi({ attachGuardian }) });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(pending);

    await user.type(screen.getByLabelText('Guardian email'), 'adult@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ME_QUERY_KEY }));
    const button = screen.getByRole('button', { name: 'Send invitation' });
    expect(button).toBeDisabled();
    expect(attachGuardian).toHaveBeenCalledTimes(1);

    await user.click(button).catch(() => {});
    expect(attachGuardian).toHaveBeenCalledTimes(1);

    resolveInvalidate();
    await waitFor(() => expect(invalidateSpy.mock.results[0]?.value).toBe(pending));
  });

  test('invalidates, then navigates only after invalidation resolves', async () => {
    const attachGuardian = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn();
    let resolveInvalidate: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      resolveInvalidate = resolve;
    });
    const { user, queryClient } = renderGuardian({
      api: accountApi({ attachGuardian }),
      navigate,
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(pending);

    await user.type(screen.getByLabelText('Guardian email'), 'adult@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ME_QUERY_KEY });
      expect(navigate).not.toHaveBeenCalled();
    });

    resolveInvalidate();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/account' }));
  });

  test('Cancel is a link to /account', () => {
    renderGuardian();
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/account');
  });
});

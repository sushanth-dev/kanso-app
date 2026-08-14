import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import type { Me, Player } from '../api/account-api.ts';
import { AccountScreen } from './account-route.tsx';

const playerId = '00000000-0000-4000-8000-000000000001';
const guardedId = '00000000-0000-4000-8000-000000000002';

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
    guardedPlayers: [player({ id: guardedId, displayName: 'Theo' })],
    ...overrides,
  };
}

describe('AccountScreen', () => {
  test('renders account identity and the owned and guarded lists', () => {
    render(
      <AccountScreen
        me={meFixture()}
        signOut={vi.fn().mockResolvedValue(undefined)}
        clearAccount={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Your account' })).toBeVisible();
    expect(screen.getByText('Owned Mina')).toBeVisible();
    expect(screen.getByText('Guarded Theo')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Players you support' })).toBeVisible();
    expect(screen.getByText('player@example.com')).toBeVisible();
    expect(screen.getByText('Free')).toBeVisible();
  });

  test('signs out through the injected handler', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn().mockResolvedValue(undefined);
    const clearAccount = vi.fn();
    render(<AccountScreen me={meFixture()} signOut={signOut} clearAccount={clearAccount} />);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(signOut).toHaveBeenCalledOnce();
  });

  test('shows the owned empty-state message when there are no owned players', () => {
    render(
      <AccountScreen
        me={meFixture({ players: [] })}
        signOut={vi.fn().mockResolvedValue(undefined)}
        clearAccount={vi.fn()}
      />,
    );

    expect(screen.getByText('No players yet')).toBeVisible();
  });

  test('shows the guarded empty-state message when there are no guarded players', () => {
    render(
      <AccountScreen
        me={meFixture({ guardedPlayers: [] })}
        signOut={vi.fn().mockResolvedValue(undefined)}
        clearAccount={vi.fn()}
      />,
    );

    expect(screen.getByText('No players you support')).toBeVisible();
  });

  test('owned cards link to edit and guardian paths, guarded cards are read-only', () => {
    render(
      <AccountScreen
        me={meFixture()}
        signOut={vi.fn().mockResolvedValue(undefined)}
        clearAccount={vi.fn()}
      />,
    );

    const owned = screen.getByRole('region', { name: 'Your players' });
    expect(within(owned).getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      `/account/players/${playerId}/edit`,
    );
    expect(within(owned).getByRole('link', { name: 'Add guardian' })).toHaveAttribute(
      'href',
      `/account/players/${playerId}/guardian`,
    );

    const guarded = screen.getByRole('region', { name: 'Players you support' });
    expect(within(guarded).queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
    expect(within(guarded).queryByRole('link', { name: 'Add guardian' })).not.toBeInTheDocument();
  });
});

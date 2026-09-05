import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError } from '../api/account-api.ts';
import { gameShareApi, type GameShareLink } from '../api/game-share-api.ts';
import { GameShareLinksSection } from './game-share-links-section.tsx';

const GAME_ID = '66666666-6666-4666-8666-666666666666';

function linkFixture(overrides: Partial<GameShareLink> = {}): GameShareLink {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    token: 'g'.repeat(43),
    url: `http://localhost:3000/shared/games/${'g'.repeat(43)}`,
    createdAt: '2026-09-05T00:00:00.000Z',
    revokedAt: null,
    expiresAt: null,
    ...overrides,
  };
}

function renderSection() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <GameShareLinksSection gameId={GAME_ID} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GameShareLinksSection', () => {
  test('creates a link for the game, with the optional expiry, and refreshes the list', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(gameShareApi, 'createGameShareLink').mockResolvedValue(linkFixture());
    vi.spyOn(gameShareApi, 'listGameShareLinks').mockResolvedValue([]);

    renderSection();

    await screen.findByText('No share links yet.');
    await user.type(screen.getByLabelText('Expires (optional)'), '2026-12-01');
    await user.click(screen.getByRole('button', { name: 'Create share link' }));

    expect(create.mock.calls[0]?.[1].expiresAt?.endsWith('Z')).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  test('creates without an expiry when the date is left empty', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(gameShareApi, 'createGameShareLink').mockResolvedValue(linkFixture());
    vi.spyOn(gameShareApi, 'listGameShareLinks').mockResolvedValue([]);

    renderSection();

    await screen.findByText('No share links yet.');
    await user.click(screen.getByRole('button', { name: 'Create share link' }));

    expect(create).toHaveBeenCalledWith(GAME_ID, {});
  });

  test('lists live links with copy and revoke', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    vi.spyOn(gameShareApi, 'listGameShareLinks').mockResolvedValue([linkFixture()]);
    const revoke = vi.spyOn(gameShareApi, 'revokeGameShareLink').mockResolvedValue(undefined);

    renderSection();

    expect(await screen.findByText(/shared\/games\//)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/shared/games/'));

    await user.click(screen.getByRole('button', { name: 'Revoke link' }));
    await user.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    expect(revoke).toHaveBeenCalledWith(GAME_ID, linkFixture().id);
  });

  test('keeps the revoke honest when the API refuses', async () => {
    const user = userEvent.setup();
    vi.spyOn(gameShareApi, 'listGameShareLinks').mockResolvedValue([linkFixture()]);
    vi.spyOn(gameShareApi, 'revokeGameShareLink').mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Something broke.'),
    );

    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Revoke link' }));
    await user.click(screen.getByRole('button', { name: 'Confirm revoke' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The link could not be revoked. Please try again.',
    );
  });
});

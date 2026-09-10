import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError } from '../api/account-api.ts';
import { primingApi, type PrimingToken } from '../api/priming-api.ts';
import { PrimingLinkSection } from './priming-link-section.tsx';

function tokenFixture(overrides: Partial<PrimingToken> = {}): PrimingToken {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    tokenPrefix: 'a1b2c3d4',
    createdAt: '2026-09-08T00:00:00.000Z',
    ...overrides,
  };
}

function renderSection() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <PrimingLinkSection />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PrimingLinkSection', () => {
  test('creates a token and shows the secret once', async () => {
    const user = userEvent.setup();
    const secret = 't'.repeat(43);
    vi.spyOn(primingApi, 'createPrimingToken').mockResolvedValue({
      ...tokenFixture(),
      token: secret,
    });
    // The first list call runs before the create; the refetch after the
    // create invalidation is what names the new live token.
    const list = vi
      .spyOn(primingApi, 'listPrimingTokens')
      .mockResolvedValueOnce([])
      .mockResolvedValue([tokenFixture()]);

    renderSection();

    expect(await screen.findByText('No token yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create priming token' }));

    expect(await screen.findByText(secret)).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Live token a1b2c3d4/)).toBeInTheDocument();
  });

  test('copies the secret when asked', async () => {
    const user = userEvent.setup();
    const secret = 't'.repeat(43);
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    vi.spyOn(primingApi, 'createPrimingToken').mockResolvedValue({
      ...tokenFixture(),
      token: secret,
    });
    vi.spyOn(primingApi, 'listPrimingTokens')
      .mockResolvedValueOnce([])
      .mockResolvedValue([tokenFixture()]);

    renderSection();

    await user.click(screen.getByRole('button', { name: 'Create priming token' }));
    await screen.findByText(secret);
    await user.click(screen.getByRole('button', { name: 'Copy token' }));

    expect(writeText).toHaveBeenCalledWith(secret);
  });

  test('a live token is named by prefix, and revoking it is confirmed', async () => {
    const user = userEvent.setup();
    vi.spyOn(primingApi, 'listPrimingTokens').mockResolvedValue([tokenFixture()]);
    const revoke = vi.spyOn(primingApi, 'revokePrimingToken').mockResolvedValue(undefined);

    renderSection();

    expect(await screen.findByText(/Live token a1b2c3d4/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy token' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Revoke token' }));
    await user.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    expect(revoke).toHaveBeenCalledWith(tokenFixture().id);
  });

  test('keeps the revoke honest when the API refuses', async () => {
    const user = userEvent.setup();
    vi.spyOn(primingApi, 'listPrimingTokens').mockResolvedValue([tokenFixture()]);
    vi.spyOn(primingApi, 'revokePrimingToken').mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Something broke.'),
    );

    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Revoke token' }));
    await user.click(screen.getByRole('button', { name: 'Confirm revoke' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The token could not be revoked. Please try again.',
    );
  });
});

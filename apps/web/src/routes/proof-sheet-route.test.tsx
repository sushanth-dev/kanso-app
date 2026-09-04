import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError } from '../api/account-api.ts';
import { proofSheetApi, type ProofSheet } from '../api/proof-sheet-api.ts';
import { createAppRouter } from '../router.tsx';
import { ProofSheetScreen } from './proof-sheet-route.tsx';

function sheetFixture(overrides: Partial<ProofSheet> = {}): ProofSheet {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    token: 't'.repeat(43),
    url: `http://localhost:3000/shared/proof-sheets/${'t'.repeat(43)}`,
    createdAt: '2026-08-17T00:00:00.000Z',
    revokedAt: null,
    expiresAt: null,
    ...overrides,
  };
}

function renderScreen() {
  const user = userEvent.setup();
  const queryClient = new QueryClient();
  const history = createMemoryHistory();
  const router = createAppRouter({ history, queryClient });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <ProofSheetScreen />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
  return { user, queryClient };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProofSheetScreen', () => {
  test('lists each live share link with a copy button', async () => {
    const sheet = sheetFixture();
    vi.spyOn(proofSheetApi, 'listProofSheets').mockResolvedValue([sheet]);
    renderScreen();

    expect(await screen.findByText(/Created on/)).toBeInTheDocument();
    expect(screen.getByText(sheet.url)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke link' })).toBeInTheDocument();
  });

  test('create produces a working link, shown in the list', async () => {
    const sheets: ProofSheet[] = [];
    vi.spyOn(proofSheetApi, 'listProofSheets').mockImplementation(() => Promise.resolve(sheets));
    vi.spyOn(proofSheetApi, 'createProofSheet').mockImplementation(() => {
      const sheet = sheetFixture();
      sheets.push(sheet);
      return Promise.resolve(sheet);
    });
    const { user } = renderScreen();

    expect(await screen.findByText('No share links yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create a share link' }));

    expect(await screen.findByText(sheetFixture().url)).toBeInTheDocument();
  });

  test('copy writes the link to the clipboard', async () => {
    const sheet = sheetFixture();
    vi.spyOn(proofSheetApi, 'listProofSheets').mockResolvedValue([sheet]);
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const { user } = renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(sheet.url));
  });

  test('revoke asks for confirmation first, then stops the link', async () => {
    let sheets = [sheetFixture()];
    vi.spyOn(proofSheetApi, 'listProofSheets').mockImplementation(() => Promise.resolve(sheets));
    const revoke = vi.spyOn(proofSheetApi, 'revokeProofSheet').mockImplementation(() => {
      sheets = [];
      return Promise.resolve();
    });
    const { user } = renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Revoke link' }));
    expect(screen.getByText(/Anyone holding this link/)).toBeInTheDocument();
    expect(revoke).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith(sheetFixture().id));
    expect(await screen.findByText('No share links yet.')).toBeInTheDocument();
  });

  test('a free account is refused with the paid-boundary prompt', async () => {
    vi.spyOn(proofSheetApi, 'listProofSheets').mockRejectedValue(
      new ApiRequestError(403, 'upgrade_required', undefined, 'Upgrade to unlock this.'),
    );
    renderScreen();

    expect(
      await screen.findByRole('heading', { name: 'The proof sheet is part of the paid loop' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See plans' })).toBeInTheDocument();
  });

  test('a player with no active focus is sent to set one', async () => {
    vi.spyOn(proofSheetApi, 'listProofSheets').mockResolvedValue([]);
    vi.spyOn(proofSheetApi, 'createProofSheet').mockRejectedValue(
      new ApiRequestError(
        404,
        'not_found',
        undefined,
        'No such player, or no active focus to prove anything about.',
      ),
    );
    const { user } = renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Create a share link' }));
    expect(await screen.findByRole('heading', { name: 'Set a focus first' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set a focus' })).toBeInTheDocument();
  });
  test('shows a loading skeleton while the share links are fetched', async () => {
    const { promise } = Promise.withResolvers<ProofSheet[]>();
    vi.spyOn(proofSheetApi, 'listProofSheets').mockReturnValue(promise);

    renderScreen();

    expect(await screen.findByRole('status', { name: 'Loading share links' })).toBeVisible();
  });

  test('shows the plain empty state for a load failure that is not the paid boundary', async () => {
    vi.spyOn(proofSheetApi, 'listProofSheets').mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Server error.'),
    );
    renderScreen();

    expect(
      await screen.findByRole('heading', { name: 'Your share links could not be loaded' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'The proof sheet is part of the paid loop' }),
    ).not.toBeInTheDocument();
  });

  test('a generic create failure states the error and keeps the page usable', async () => {
    vi.spyOn(proofSheetApi, 'listProofSheets').mockResolvedValue([]);
    vi.spyOn(proofSheetApi, 'createProofSheet').mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Server error.'),
    );
    const { user } = renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Create a share link' }));

    expect(
      await screen.findByText('The share link could not be created. Please try again.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a share link' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: 'Set a focus first' })).not.toBeInTheDocument();
  });

  test('a revoke failure states the error and keeps the link', async () => {
    vi.spyOn(proofSheetApi, 'listProofSheets').mockResolvedValue([sheetFixture()]);
    vi.spyOn(proofSheetApi, 'revokeProofSheet').mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Server error.'),
    );
    const { user } = renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Revoke link' }));
    await user.click(screen.getByRole('button', { name: 'Confirm revoke' }));

    expect(
      await screen.findByText('The link could not be revoked. Please try again.'),
    ).toBeInTheDocument();
    expect(screen.getByText(sheetFixture().url)).toBeInTheDocument();
  });

  test('keeping the link closes the confirmation without revoking', async () => {
    vi.spyOn(proofSheetApi, 'listProofSheets').mockResolvedValue([sheetFixture()]);
    const revoke = vi.spyOn(proofSheetApi, 'revokeProofSheet').mockResolvedValue(undefined);
    const { user } = renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Revoke link' }));
    await user.click(screen.getByRole('button', { name: 'Keep link' }));

    expect(screen.queryByText(/Anyone holding this link/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke link' })).toBeInTheDocument();
    expect(revoke).not.toHaveBeenCalled();
  });

  test('copy labels the button as copied', async () => {
    vi.spyOn(proofSheetApi, 'listProofSheets').mockResolvedValue([sheetFixture()]);
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const { user } = renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Copy' }));

    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});

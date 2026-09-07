import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError } from '../api/account-api.ts';
import { guardianApi } from '../api/guardian-api.ts';
import type * as GuardianApi from '../api/guardian-api.ts';
import { createAppRouter } from '../router.tsx';

// The route reads the singleton from this module, so the module is mocked the
// way router.test.tsx mocks account-api rather than spied on the live object.
vi.mock('../api/guardian-api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof GuardianApi>();
  return { ...actual, guardianApi: { confirmGuardian: vi.fn() } };
});

// eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() from the module mock.
const confirmGuardian = vi.mocked(guardianApi.confirmGuardian);

function renderAt(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('GuardianConfirmRoute', () => {
  test('shows the consent recorded page for a valid link', async () => {
    confirmGuardian.mockResolvedValue(undefined);

    renderAt('/guardians/confirm/valid');

    expect(await screen.findByRole('heading', { name: 'Consent recorded' })).toBeInTheDocument();
    expect(
      screen.getByText("Thank you. The player's account is now ready to use."),
    ).toBeInTheDocument();
  });

  test('keeps its own main landmark and wraps its content in a reveal-in Card', async () => {
    confirmGuardian.mockResolvedValue(undefined);

    renderAt('/guardians/confirm/valid');
    await screen.findByRole('heading', { name: 'Consent recorded' });

    const main = screen.getByRole('main');
    expect(main.querySelector('.reveal-in')).toBeInTheDocument();
  });

  test('shows the one indistinguishable unavailable page for a tampered or expired link', async () => {
    confirmGuardian.mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No such page.'),
    );

    renderAt('/guardians/confirm/dead');

    expect(
      await screen.findByRole('heading', { name: 'This link is no longer available.' }),
    ).toBeInTheDocument();
  });
  test('shows a loading status while the consent is recorded', async () => {
    const { promise } = Promise.withResolvers<void>();
    confirmGuardian.mockReturnValue(promise);

    renderAt('/guardians/confirm/loading');

    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  test('thanks the guardian in plain words for a valid link', async () => {
    confirmGuardian.mockResolvedValue(undefined);

    renderAt('/guardians/confirm/valid');

    expect(await screen.findByRole('heading', { name: 'Consent recorded' })).toBeInTheDocument();
    expect(
      screen.getByText("Thank you. The player's account is now ready to use."),
    ).toBeInTheDocument();
  });

  test('a server failure reads the same as a dead link, never as a consent error', async () => {
    confirmGuardian.mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Server error.'),
    );

    renderAt('/guardians/confirm/broken');

    expect(
      await screen.findByRole('heading', { name: 'This link is no longer available.' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Thank you/)).not.toBeInTheDocument();
  });
});

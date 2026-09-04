import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError } from '../api/account-api.ts';
import { nudgeApi } from '../api/nudge-api.ts';
import type * as NudgeApi from '../api/nudge-api.ts';
import { createAppRouter } from '../router.tsx';

// The route reads the singleton from this module, so the module is mocked the
// way router.test.tsx mocks account-api rather than spied on the live object.
vi.mock('../api/nudge-api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof NudgeApi>();
  return { ...actual, nudgeApi: { unsubscribe: vi.fn() } };
});

// eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() from the module mock.
const unsubscribe = vi.mocked(nudgeApi.unsubscribe);

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

describe('NudgeUnsubscribeRoute', () => {
  test('shows the unsubscribed page for a valid link', async () => {
    unsubscribe.mockResolvedValue(undefined);

    renderAt('/nudge/unsubscribe/valid');

    expect(
      await screen.findByRole('heading', { name: 'You are unsubscribed' }),
    ).toBeInTheDocument();
  });

  test('shows the one indistinguishable unavailable page for a tampered or expired link', async () => {
    unsubscribe.mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No such page.'),
    );

    renderAt('/nudge/unsubscribe/dead');

    expect(
      await screen.findByRole('heading', { name: 'This link is no longer available.' }),
    ).toBeInTheDocument();
  });
  test('shows a loading status while the unsubscribe is recorded', async () => {
    const { promise } = Promise.withResolvers<void>();
    unsubscribe.mockReturnValue(promise);

    renderAt('/nudge/unsubscribe/pending');

    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  test('explains that only the nudge stops for a valid link', async () => {
    unsubscribe.mockResolvedValue(undefined);

    renderAt('/nudge/unsubscribe/valid');

    expect(
      await screen.findByRole('heading', { name: 'You are unsubscribed' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'One link stops these emails, and this was it. The nudge will not reach this address again; everything else in the app is unchanged.',
      ),
    ).toBeInTheDocument();
  });

  test('a server failure reads the same as a dead link', async () => {
    unsubscribe.mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Server error.'),
    );

    renderAt('/nudge/unsubscribe/broken');

    expect(
      await screen.findByRole('heading', { name: 'This link is no longer available.' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/You are unsubscribed/)).not.toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError } from '../api/account-api.ts';
import { sharedCardApi } from '../api/report-share-api.ts';
import { createAppRouter } from '../router.tsx';

vi.mock('../analytics.ts', () => ({ track: vi.fn() }));

function renderRoute(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'share');
  vi.restoreAllMocks();
});

describe('SharedCardRoute', () => {
  test('renders the headline number, its label, and nothing else', async () => {
    vi.spyOn(sharedCardApi, 'getShared').mockResolvedValue({
      ratingLeak: 84,
      label: 'Hanging piece',
    });

    renderRoute('/shared/cards/tokentokentokentokentokentokentokentokentoken');

    expect(await screen.findByRole('heading', { name: 'Hanging piece' })).toBeVisible();
    expect(screen.getByText('84')).toBeVisible();
    // The scoping contract, at the surface: no second data point, no identity.
    expect(screen.queryByText(/rating points/i)).toBeVisible();
    expect(screen.queryByText(/games/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/opponent/i)).not.toBeInTheDocument();
  });

  test('offers the native share sheet when the platform has one', async () => {
    const user = userEvent.setup();
    const share = vi.fn<(data: ShareData) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'share', { value: share, configurable: true });
    vi.spyOn(sharedCardApi, 'getShared').mockResolvedValue({
      ratingLeak: 84,
      label: 'Hanging piece',
    });

    renderRoute('/shared/cards/tokentokentokentokentokentokentokentokentoken');
    await user.click(await screen.findByRole('button', { name: 'Share card' }));
    expect(share).toHaveBeenCalledTimes(1);
    const [shared] = share.mock.calls[0] ?? [];
    expect(shared?.url).toContain('/shared/cards/');
  });

  test('copies the link when there is no share sheet', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    vi.spyOn(sharedCardApi, 'getShared').mockResolvedValue({
      ratingLeak: 84,
      label: 'Hanging piece',
    });

    renderRoute('/shared/cards/tokentokentokentokentokentokentokentokentoken');
    await user.click(await screen.findByRole('button', { name: 'Copy link' }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/shared/cards/'));
  });

  test('shows the one indistinguishable unavailable page for a dead link', async () => {
    vi.spyOn(sharedCardApi, 'getShared').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No such shared card.'),
    );

    renderRoute('/shared/cards/dead');

    expect(
      await screen.findByRole('heading', { name: 'This link is no longer available.' }),
    ).toBeVisible();
  });

  test('ST-147: every state enters on the system, and the retry holds the touch floor', async () => {
    vi.spyOn(sharedCardApi, 'getShared').mockResolvedValue({
      ratingLeak: 84,
      label: 'Hanging piece',
    });

    renderRoute('/shared/cards/tokentokentokentokentokentokentokentokentoken');

    const main = (await screen.findByRole('heading', { name: 'Hanging piece' })).closest('main');
    expect(main).toHaveClass('reveal-in');
    expect(screen.getByRole('button', { name: 'Copy link' })).toHaveClass('min-h-11');
  });

  test('offers a retry when the page could not be reached', async () => {
    vi.spyOn(sharedCardApi, 'getShared').mockRejectedValue(new TypeError('network down'));

    renderRoute('/shared/cards/tokentokentokentokentokentokentokentokentoken');

    expect(
      await screen.findByRole('heading', { name: 'This page could not be reached.' }),
    ).toBeVisible();
  });
});

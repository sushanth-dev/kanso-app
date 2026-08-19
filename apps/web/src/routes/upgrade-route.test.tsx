import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { accountApi } from '../api/account-api.ts';
import type * as AccountApi from '../api/account-api.ts';
import { createAppRouter } from '../router.tsx';
import { track } from '../analytics.ts';
import { checkoutApi } from '../api/checkout-api.ts';

vi.mock('../api/account-api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof AccountApi>();
  return {
    ...actual,
    accountApi: { getMe: vi.fn(), createPlayer: vi.fn(), updatePlayer: vi.fn() },
  };
});

vi.mock('../auth-client.ts', () => ({
  authClient: {
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
    signOut: vi.fn(),
  },
}));

vi.mock('../analytics.ts', () => ({
  track: vi.fn(),
}));

vi.mock('../api/checkout-api.ts', () => ({
  checkoutApi: { checkout: vi.fn() },
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- getMe is a vi.fn() from the module mock.
const getMe = vi.mocked(accountApi.getMe);
const trackMock = vi.mocked(track);
// eslint-disable-next-line @typescript-eslint/unbound-method -- checkout is a vi.fn() from the module mock.
const checkoutMock = vi.mocked(checkoutApi.checkout);

const RAZORPAY_CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

function freeMe(tier: 'free' | 'paid' = 'free'): AccountApi.Me {
  return {
    userId: 'user-1',
    email: 'player@example.com',
    name: 'Player',
    tier,
    players: [],
  };
}

function renderAt(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('UpgradeRoute', () => {
  beforeEach(() => {
    getMe.mockReset();
    getMe.mockResolvedValue(freeMe());
    checkoutMock.mockReset();
    trackMock.mockClear();
    delete (window as unknown as { Razorpay?: unknown }).Razorpay;
  });

  test('states the boundary and the three prices', async () => {
    renderAt('/account/upgrade');

    expect(
      await screen.findByRole('heading', { name: 'Upgrade to the full loop' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Your first diagnosis is free/)).toBeInTheDocument();
    expect(screen.getByText('$15')).toBeInTheDocument();
    expect(screen.getByText('$130')).toBeInTheDocument();
    expect(screen.getByText('$150')).toBeInTheDocument();
  });

  test('gives each plan a pay button', async () => {
    renderAt('/account/upgrade');

    expect(await screen.findByRole('button', { name: 'Pay $15' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay $130' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay $150' })).toBeInTheDocument();
  });

  test('does not render pay buttons while getMe is pending', async () => {
    let resolveMe!: (me: AccountApi.Me) => void;
    getMe.mockImplementation(
      () =>
        new Promise<AccountApi.Me>((resolve) => {
          resolveMe = resolve;
        }),
    );

    renderAt('/account/upgrade');

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Pay $15' })).not.toBeInTheDocument();
    });

    resolveMe(freeMe());
    expect(await screen.findByRole('button', { name: 'Pay $15' })).toBeInTheDocument();
  });

  test('shows the already-paid state and no pay buttons when getMe resolves paid', async () => {
    getMe.mockResolvedValue(freeMe('paid'));

    renderAt('/account/upgrade');

    expect(
      await screen.findByRole('heading', { name: 'Your account is already paid' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pay \$/ })).not.toBeInTheDocument();
  });

  test('shows provider-unreachable when the Razorpay script never loads', async () => {
    const user = userEvent.setup();
    checkoutMock.mockResolvedValue({
      keyId: 'rzp_test',
      amount: 1500,
      currency: 'USD',
      orderId: 'order_1',
    });

    renderAt('/account/upgrade');
    await user.click(await screen.findByRole('button', { name: 'Pay $15' }));

    const script = await waitFor(() => {
      const el = document.querySelector<HTMLScriptElement>(
        `script[src="${RAZORPAY_CHECKOUT_SRC}"]`,
      );
      if (el === null) throw new Error('Razorpay script not appended');
      return el;
    });

    // jsdom does not load external scripts; resolve the loader as failed.
    script.dispatchEvent(new Event('error'));

    expect(await screen.findByText(/payment provider could not be reached/i)).toBeInTheDocument();
    expect(screen.queryByText(/payment received/i)).not.toBeInTheDocument();
  });

  test('shows checkout-failure when checkout rejects', async () => {
    const user = userEvent.setup();
    checkoutMock.mockRejectedValue(new Error('checkout failed'));

    renderAt('/account/upgrade');
    await user.click(await screen.findByRole('button', { name: 'Pay $15' }));

    expect(await screen.findByText(/payment could not be started/i)).toBeInTheDocument();
    expect(screen.queryByText(/payment received/i)).not.toBeInTheDocument();
  });

  test('fires converted_to_paid when the poll sees the tier flip', async () => {
    const user = userEvent.setup();
    let tier: 'free' | 'paid' = 'free';
    getMe.mockImplementation(() => Promise.resolve(freeMe(tier)));
    checkoutMock.mockResolvedValue({
      keyId: 'rzp_test',
      amount: 1500,
      currency: 'USD',
      orderId: 'order_1',
    });
    let razorpayHandler: (() => void) | undefined;
    window.Razorpay = class {
      constructor(options: { handler: () => void }) {
        razorpayHandler = options.handler;
      }
      open(): void {}
    };

    renderAt('/account/upgrade');
    await user.click(await screen.findByRole('button', { name: 'Pay $15' }));

    await waitFor(() => expect(razorpayHandler).toBeDefined());
    tier = 'paid';
    razorpayHandler?.();

    await waitFor(() =>
      expect(trackMock).toHaveBeenCalledWith('converted_to_paid', { plan: 'monthly' }),
    );
  });
});

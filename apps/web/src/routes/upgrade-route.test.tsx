import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { accountApi } from '../api/account-api.ts';
import type * as AccountApi from '../api/account-api.ts';
import { createAppRouter } from '../router.tsx';
import { track } from '../analytics.ts';
import { checkoutApi, type CheckoutResponse } from '../api/checkout-api.ts';

vi.mock('../api/account-api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof AccountApi>();
  return {
    ...actual,
    accountApi: { getSession: vi.fn(), getMe: vi.fn(), updateMe: vi.fn() },
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

function meWithTier(tier: AccountApi.Tier = 'beginner'): AccountApi.Me {
  return {
    userId: 'user-1',
    email: 'player@example.com',
    name: 'Player',
    tier,
    // ST-176. These fixtures predate the analytics gate, so they read the way an
    // account that has stated no age does, which is also the fail-shut default.
    analyticsSuiteAllowed: false,
    player: {
      id: '00000000-0000-4000-8000-000000000001',
      displayName: 'Player',
      birthYear: null,
      fideId: null,
      fideRating: null,
      uscfId: null,
      uscfRating: null,
      chesscomUsername: null,
      lichessUsername: null,
      chesscomRating: null,
      lichessRating: null,
      currentStreak: 0,
      xp: 0,
      level: 1,
      createdAt: '2026-08-14T00:00:00.000Z',
    },
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
    getMe.mockResolvedValue(meWithTier());
    checkoutMock.mockReset();
    trackMock.mockClear();
    delete (window as unknown as { Razorpay?: unknown }).Razorpay;
    // jsdom keeps the appended checkout scripts after a test; a leftover
    // script's handlers belong to a dead promise and would swallow the next
    // test's load/error signal.
    document
      .querySelectorAll<HTMLScriptElement>(`script[src="${RAZORPAY_CHECKOUT_SRC}"]`)
      .forEach((script) => script.remove());
  });

  test('states the boundary and the three plans', async () => {
    renderAt('/upgrade');

    expect(await screen.findByRole('heading', { name: 'Choose a plan' })).toBeInTheDocument();
    expect(screen.getByText(/Your first diagnosis is free/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Beginner' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Intermediate' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pro' })).toBeInTheDocument();
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByText('₹799')).toBeInTheDocument();
    expect(screen.getByText('₹1,299')).toBeInTheDocument();
  });

  test('carries the entrance motion classes on the header and the plan-card grid', async () => {
    renderAt('/upgrade');

    expect(
      (await screen.findByRole('heading', { name: 'Choose a plan' })).closest('.reveal-in'),
    ).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Beginner' }).closest('.stagger-in')).not.toBeNull();
  });

  test('marks intermediate as most popular', async () => {
    renderAt('/upgrade');

    expect(await screen.findByText('Most popular')).toBeInTheDocument();
  });

  test('gives intermediate and pro a pay button, and beginner none', async () => {
    renderAt('/upgrade');

    expect(await screen.findByRole('button', { name: 'Pay ₹799' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay ₹1,299' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pay Free' })).not.toBeInTheDocument();
  });

  test('does not render pay buttons while getMe is pending', async () => {
    let resolveMe!: (me: AccountApi.Me) => void;
    getMe.mockImplementation(
      () =>
        new Promise<AccountApi.Me>((resolve) => {
          resolveMe = resolve;
        }),
    );

    renderAt('/upgrade');

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Pay ₹799' })).not.toBeInTheDocument();
    });

    resolveMe(meWithTier());
    expect(await screen.findByRole('button', { name: 'Pay ₹799' })).toBeInTheDocument();
  });

  test('shows which plan a pro account is already on, and no pay buttons', async () => {
    getMe.mockResolvedValue(meWithTier('pro'));

    renderAt('/upgrade');

    expect(
      await screen.findByRole('heading', { name: 'You are on the Pro plan' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pay \$/ })).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'You are on the Pro plan' }).closest('.reveal-in'),
    ).not.toBeNull();
  });

  test('shows which plan an intermediate account is already on', async () => {
    getMe.mockResolvedValue(meWithTier('intermediate'));

    renderAt('/upgrade');

    expect(
      await screen.findByRole('heading', { name: 'You are on the Intermediate plan' }),
    ).toBeInTheDocument();
  });

  test('shows provider-unreachable when the Razorpay script never loads', async () => {
    const user = userEvent.setup();
    checkoutMock.mockResolvedValue({
      keyId: 'rzp_test',
      amount: 79900,
      currency: 'INR',
      orderId: 'order_1',
    });

    renderAt('/upgrade');
    await user.click(await screen.findByRole('button', { name: 'Pay ₹799' }));

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

    renderAt('/upgrade');
    await user.click(await screen.findByRole('button', { name: 'Pay ₹799' }));

    expect(await screen.findByText(/payment could not be started/i)).toBeInTheDocument();
    expect(screen.queryByText(/payment received/i)).not.toBeInTheDocument();
  });

  test('fires converted_to_paid with the purchased tier when the poll sees the flip', async () => {
    const user = userEvent.setup();
    let tier: AccountApi.Tier = 'beginner';
    getMe.mockImplementation(() => Promise.resolve(meWithTier(tier)));
    checkoutMock.mockResolvedValue({
      keyId: 'rzp_test',
      amount: 79900,
      currency: 'INR',
      orderId: 'order_1',
    });
    let razorpayHandler: (() => void) | undefined;
    window.Razorpay = class {
      constructor(options: { handler: () => void }) {
        razorpayHandler = options.handler;
      }
      open(): void {}
    };

    renderAt('/upgrade');
    await user.click(await screen.findByRole('button', { name: 'Pay ₹799' }));

    await waitFor(() => expect(razorpayHandler).toBeDefined());
    tier = 'intermediate';
    razorpayHandler?.();

    await waitFor(() =>
      expect(trackMock).toHaveBeenCalledWith('converted_to_paid', { tier: 'intermediate' }),
    );
  });

  test('shows provider-unreachable when the script loads without Razorpay', async () => {
    const user = userEvent.setup();
    checkoutMock.mockResolvedValue({
      keyId: 'rzp_test',
      amount: 79900,
      currency: 'INR',
      orderId: 'order_1',
    });

    renderAt('/upgrade');
    await user.click(await screen.findByRole('button', { name: 'Pay ₹799' }));
    const script = await waitFor(() => {
      const el = document.querySelector<HTMLScriptElement>(
        `script[src="${RAZORPAY_CHECKOUT_SRC}"]`,
      );
      if (el === null) throw new Error('Razorpay script not appended');
      return el;
    });
    // The script fires onload but the widget never registered itself.
    // jsdom does not run script resources, so the handler is invoked directly.
    script.onload?.(new Event('load'));

    expect(await screen.findByText(/payment provider could not be reached/i)).toBeInTheDocument();
  });

  test('shows provider-unreachable and re-enables paying when the widget throws', async () => {
    const user = userEvent.setup();
    checkoutMock.mockResolvedValue({
      keyId: 'rzp_test',
      amount: 79900,
      currency: 'INR',
      orderId: 'order_1',
    });
    window.Razorpay = class {
      constructor() {
        throw new Error('widget exploded');
      }
      open(): void {}
    };

    renderAt('/upgrade');
    await user.click(await screen.findByRole('button', { name: 'Pay ₹799' }));

    expect(await screen.findByText(/payment provider could not be reached/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay ₹799' })).toBeEnabled();
  });

  test('keeps the other plans unclickable while one checkout is opening', async () => {
    const user = userEvent.setup();
    const { promise, resolve } = Promise.withResolvers<CheckoutResponse>();
    checkoutMock.mockReturnValue(promise);

    renderAt('/upgrade');
    await user.click(await screen.findByRole('button', { name: 'Pay ₹799' }));

    expect(screen.getByRole('button', { name: 'Opening checkout...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pay ₹1,299' })).toBeDisabled();

    resolve({ keyId: 'rzp_test', amount: 79900, currency: 'INR', orderId: 'order_1' });
  });

  test('prices the paid plans monthly and the free plan once', async () => {
    renderAt('/upgrade');

    expect(await screen.findByText('Free')).toBeInTheDocument();
    expect(screen.getAllByText('/month')).toHaveLength(2);
  });

  test('tells a pro account there is no monthly cap left to buy', async () => {
    getMe.mockResolvedValue(meWithTier('pro'));
    renderAt('/upgrade');

    expect(
      await screen.findByText(/no monthly cap: a focus, verification, the proof sheet/),
    ).toBeInTheDocument();
  });

  test('reports processing and stops the buttons when the poll never sees the flip', async () => {
    const user = userEvent.setup();
    checkoutMock.mockResolvedValue({
      keyId: 'rzp_test',
      amount: 79900,
      currency: 'INR',
      orderId: 'order_1',
    });
    let razorpayHandler: (() => void) | undefined;
    window.Razorpay = class {
      constructor(options: { handler: () => void }) {
        razorpayHandler = options.handler;
      }
      open(): void {}
    };

    renderAt('/upgrade');
    await user.click(await screen.findByRole('button', { name: 'Pay ₹799' }));
    await waitFor(() => expect(razorpayHandler).toBeDefined());
    // The fake clock starts before the poll so every retry delay is faked.
    vi.useFakeTimers();
    try {
      razorpayHandler?.();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(screen.getByText('Payment received. Confirming your upgrade...')).toBeInTheDocument();

      // Ten attempts at 1.5s each pass without the tier flipping.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(16_000);
      });
      expect(
        screen.getByText(/Your account has not updated yet\. Refresh to see your new plan\./),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Pay ₹799' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Pay ₹1,299' })).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });
});

/*
 * Direction contract (shaped directly, no seed).
 *
 * THESIS: the upgrade page states the boundary and asks for the money,
 * plainly. The free/paid split is already decided, so the page is a short
 * fact sheet and three clear prices, not a persuasion essay. It refuses the
 * category-default feature-comparison table and long sales copy.
 *
 * OWN-WORLD: Study Room. Inherits the page frame's warm paper page, raised
 * cards, ink, one terracotta accent, Source Serif 4 display over Public Sans,
 * IBM Plex Mono for every number. Restrained: the accent lives on the primary
 * action only.
 *
 * STORY: a free user lands on a paid surface, is told the loop is paid, sees
 * the three prices, picks one, and pays through Razorpay.
 *
 * FIRST VIEWPORT: a heading, one line on what paid gives, then three plan
 * cards - monthly, season (September to May), year - each with its price in
 * display type and a pay button.
 *
 * FORM: a whole surface inside an established world, shaped directly because
 * the task and content are precisely specified; no concept tournament.
 *
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, and DESIGN.md.
 */
import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { checkoutApi, type Plan } from '../api/checkout-api.ts';
import { secondaryLinkClassName } from '../components/secondary-link.ts';
import { StatusMessage } from '../components/status-message.tsx';
import { ME_QUERY_KEY, meQueryOptions } from '../query-client.ts';
import { track } from '../analytics.ts';

interface PlanOption {
  key: Plan;
  name: string;
  price: string;
  period: string;
  note?: string;
}

const PLANS: PlanOption[] = [
  { key: 'monthly', name: 'Monthly', price: '$15', period: 'a month' },
  {
    key: 'season',
    name: 'Season',
    price: '$130',
    period: 'September to May',
    note: 'The term scholastic chess runs.',
  },
  {
    key: 'yearly',
    name: 'Year',
    price: '$150',
    period: 'twelve months',
    note: 'Twelve months for the price of ten.',
  },
];

const WHAT_PAID_GIVES = [
  {
    title: 'A focus, and verification',
    body: 'One thing to work on, checked afterwards on whether it is improving, with the evidence shown honestly.',
  },
  {
    title: 'The proof sheet',
    body: 'The before-and-after page a coach sends a parent.',
  },
  {
    title: 'History and unlimited analysis',
    body: 'Compare this season to the last, and import and re-analyse without a cap.',
  },
];

interface RazorpayCheckout {
  open(): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: {
      key: string;
      amount: number;
      currency: string;
      name: string;
      order_id: string;
      handler: () => void;
      theme: { color: string };
    }) => RazorpayCheckout;
  }
}

const RAZORPAY_CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

/** The terracotta accent as a hex: Razorpay's widget takes hex, not a token. */
function accentColor(): string {
  const token = getComputedStyle(document.documentElement)
    .getPropertyValue('--kanso-color-action-primary-default')
    .trim();
  return token || '#A03F22';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadRazorpayCheckout(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = RAZORPAY_CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve(window.Razorpay !== undefined);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export function UpgradeRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [paying, setPaying] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'confirming' | 'processing'>('idle');

  async function confirmUpgrade(plan: Plan) {
    setStatus('confirming');
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      const me = await queryClient.fetchQuery(meQueryOptions());
      if (me.tier === 'paid') {
        track('converted_to_paid', { plan });
        await navigate({ to: '/account' });
        return;
      }
      await delay(1500);
    }
    setStatus('processing');
  }

  async function handlePay(plan: Plan) {
    setPaying(plan);
    setError(null);
    try {
      const checkout = await checkoutApi.checkout(plan);
      const loaded = await loadRazorpayCheckout();
      if (!loaded || !window.Razorpay) {
        setError('The payment provider could not be reached. Please try again.');
        return;
      }
      const rzp = new window.Razorpay({
        key: checkout.keyId,
        amount: checkout.amount,
        currency: checkout.currency,
        name: 'Kanso Chess',
        order_id: checkout.orderId,
        handler: () => {
          void confirmUpgrade(plan);
        },
        theme: { color: accentColor() },
      });
      rzp.open();
    } catch (paymentError) {
      setError(
        paymentError instanceof Error && paymentError.message.length > 0
          ? paymentError.message
          : 'The payment could not be started. Please try again.',
      );
    } finally {
      setPaying(null);
    }
  }

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <Link to="/account" className={secondaryLinkClassName}>
          Back to your account
        </Link>
        <Heading level={1}>Upgrade to the full loop</Heading>
        <p className="text-muted">Your first diagnosis is free. The loop after it is paid.</p>
      </header>

      <section aria-labelledby="paid-heading">
        <Heading level={2} id="paid-heading">
          What paid gives
        </Heading>
        <ul className="mt-4 grid gap-6 md:grid-cols-3">
          {WHAT_PAID_GIVES.map((item) => (
            <li key={item.title}>
              <Heading level={3}>{item.title}</Heading>
              <p className="mt-2 text-muted">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="plans-heading">
        <Heading level={2} id="plans-heading">
          Choose a plan
        </Heading>
        {error !== null ? (
          <div className="mt-4">
            <StatusMessage tone="error">{error}</StatusMessage>
          </div>
        ) : null}
        {status === 'confirming' ? (
          <div className="mt-4">
            <StatusMessage tone="success">
              Payment received. Confirming your upgrade...
            </StatusMessage>
          </div>
        ) : null}
        {status === 'processing' ? (
          <div className="mt-4">
            <StatusMessage tone="success">
              Payment received. Your account will upgrade shortly. Refresh to see it.
            </StatusMessage>
          </div>
        ) : null}
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {PLANS.map((plan) => (
            <Card key={plan.key} className="flex flex-col p-6">
              <Heading level={3}>{plan.name}</Heading>
              <p className="mt-3 font-display text-3xl leading-tight tracking-tight">
                {plan.price}
              </p>
              <p className="mt-1 text-sm text-muted">{plan.period}</p>
              {plan.note !== undefined ? (
                <p className="mt-2 text-sm text-muted">{plan.note}</p>
              ) : null}
              <Button
                label={paying === plan.key ? 'Opening checkout...' : `Pay ${plan.price}`}
                variant="primary"
                onClick={() => void handlePay(plan.key)}
                isDisabled={paying !== null || status === 'confirming'}
                className="mt-6 min-h-11 press"
              />
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

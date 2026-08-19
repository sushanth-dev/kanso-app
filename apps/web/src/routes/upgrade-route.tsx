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
 * STORY: a free user lands on a paid surface, is told what free gives, what
 * paid gives, and the three prices, picks one, and pays through Razorpay. A
 * paid user is told the loop is already open and sent back to it, never asked
 * to pay again.
 *
 * FIRST VIEWPORT: a heading, one line on the boundary, then the three plan
 * cards - monthly, season (September to May), year - each with its price in
 * mono type and a pay button.
 *
 * FORM: a whole surface inside an established world, shaped directly because
 * the task and content are precisely specified; no concept tournament.
 *
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, and DESIGN.md.
 */
import { useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { checkoutApi, type CheckoutResponse, type Plan } from '../api/checkout-api.ts';
import { primaryLinkClassName } from '../components/primary-link.ts';
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
    period: 'a season',
    note: 'September to May',
  },
  {
    key: 'yearly',
    name: 'Year',
    price: '$150',
    period: 'a year',
    note: 'Twelve months for the price of ten.',
  },
];

const WHAT_FREE_GIVES = [
  'Import from Chess.com or Lichess by username, plus PGN upload for tournament games.',
  'One diagnosis, ranked by what is costing the most rating.',
  'The rating leak number for the top weakness.',
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
    title: 'History across seasons',
    body: 'Compare this season to the last.',
  },
  {
    title: 'Unlimited imports and re-analysis',
    body: 'Import and re-analyse without a cap.',
  },
];

type PayError = 'provider-unreachable' | 'checkout-failed';

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

function UpgradeSkeleton() {
  return (
    <div role="status" aria-label="Loading upgrade" aria-busy="true" className="space-y-8">
      <div className="space-y-4">
        <div className="h-4 w-40 rounded-control bg-sunken" />
        <div className="h-8 w-64 rounded-control bg-sunken" />
        <div className="h-4 w-72 rounded-control bg-sunken" />
      </div>
      <div className="h-32 rounded-surface bg-sunken" />
      <div className="h-32 rounded-surface bg-sunken" />
    </div>
  );
}

function AlreadyPaid() {
  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <Heading level={1}>Your account is already paid</Heading>
        <Badge label="Paid" variant="neutral" />
        <p className="text-muted">
          The full loop is already open: a focus, verification, the proof sheet, history across
          seasons, and unlimited imports and re-analysis. Set a focus and check on it from your
          account.
        </p>
      </header>
      <Link to="/account" className={primaryLinkClassName}>
        Back to your account
      </Link>
    </div>
  );
}

export function UpgradeRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const meQuery = useQuery(meQueryOptions());
  const [paying, setPaying] = useState<Plan | null>(null);
  const [payError, setPayError] = useState<PayError | null>(null);
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
    setPayError(null);

    let checkout: CheckoutResponse;
    try {
      checkout = await checkoutApi.checkout(plan);
    } catch {
      setPaying(null);
      setPayError('checkout-failed');
      return;
    }

    const loaded = await loadRazorpayCheckout();
    if (!loaded || !window.Razorpay) {
      setPaying(null);
      setPayError('provider-unreachable');
      return;
    }

    try {
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
    } catch {
      setPayError('provider-unreachable');
    } finally {
      setPaying(null);
    }
  }

  if (meQuery.isPending) {
    return <UpgradeSkeleton />;
  }

  if (meQuery.data?.tier === 'paid') {
    return <AlreadyPaid />;
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

      <section aria-labelledby="free-heading">
        <Heading level={2} id="free-heading">
          What free gives
        </Heading>
        <ul className="mt-4 space-y-2">
          {WHAT_FREE_GIVES.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="paid-heading">
        <Heading level={2} id="paid-heading">
          What paid gives
        </Heading>
        <ul className="mt-4 grid gap-6 md:grid-cols-2">
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
        {payError === 'provider-unreachable' ? (
          <div className="mt-4">
            <StatusMessage tone="error">
              Checkout could not open. The payment provider could not be reached. Please try again.
            </StatusMessage>
          </div>
        ) : null}
        {payError === 'checkout-failed' ? (
          <div className="mt-4">
            <StatusMessage tone="error">
              The payment could not be started. Please try again.
            </StatusMessage>
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
              Payment received. Your account has not updated yet. Refresh to see your paid tier.
            </StatusMessage>
          </div>
        ) : null}
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {PLANS.map((plan) => (
            <Card key={plan.key} className="flex flex-col p-6">
              <Heading level={3}>{plan.name}</Heading>
              <p className="mt-3 font-mono text-3xl leading-tight tracking-tight">{plan.price}</p>
              <p className="mt-1 text-sm text-muted">{plan.period}</p>
              {plan.note !== undefined ? (
                <p className="mt-2 text-sm text-muted">{plan.note}</p>
              ) : null}
              <Button
                label={paying === plan.key ? 'Opening checkout...' : `Pay ${plan.price}`}
                variant="primary"
                onClick={() => void handlePay(plan.key)}
                isDisabled={paying !== null || status !== 'idle'}
                className="mt-6 min-h-11 press"
              />
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

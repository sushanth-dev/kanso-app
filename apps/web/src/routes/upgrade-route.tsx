/*
 * Direction contract (shaped directly, no seed).
 *
 * THESIS: the upgrade page states the boundary and asks for the money,
 * plainly. The three plans are already decided, so the page is a short fact
 * sheet and three clear cards, not a persuasion essay. It refuses the
 * category-default feature-comparison table and long sales copy.
 *
 * OWN-WORLD: Study Room. Inherits the page frame's warm paper page, raised
 * cards, ink, one terracotta accent, Source Serif 4 display over Public Sans,
 * IBM Plex Mono for every number. Restrained: the accent lives on the primary
 * action and the "most popular" mark only.
 *
 * STORY: a beginner lands on a paid surface, is told what each plan gives and
 * what it costs, picks intermediate or pro, and pays through Razorpay. An
 * account already on a paid plan is told which one and sent back to it, never
 * asked to pay again.
 *
 * FIRST VIEWPORT: a heading, one line on the boundary, then the three plan
 * cards - beginner, intermediate, pro - each with its limit, its price in
 * mono type, and a pay button (beginner needs none).
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
import { Text } from '@astryxdesign/core/Text';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { checkoutApi, type CheckoutResponse, type PayableTier } from '../api/checkout-api.ts';
import type { Tier } from '../api/account-api.ts';
import { StatusMessage } from '../components/status-message.tsx';
import { ME_QUERY_KEY, meQueryOptions } from '../query-client.ts';
import { track } from '../analytics.ts';

interface PlanOption {
  tier: Tier;
  name: string;
  price: string;
  limit: string;
  features: string[];
  mostPopular?: boolean;
}

const PLANS: PlanOption[] = [
  {
    tier: 'beginner',
    name: 'Beginner',
    price: 'Free',
    limit: '30 games analysed a month',
    features: [
      'Import from Chess.com or Lichess by username, plus PGN upload for tournament games.',
      'One diagnosis, ranked by what is costing the most rating.',
      'The rating leak number for the top weakness.',
      '50 coach explanations a month.',
    ],
  },
  {
    tier: 'intermediate',
    name: 'Intermediate',
    price: '₹799',
    limit: '150 games analysed a month',
    features: [
      'A focus, and verification afterwards, checked honestly.',
      'The proof sheet, the before-and-after page a coach sends a parent.',
      'Unlimited imports and re-analysis, up to the monthly cap.',
      '100 coach explanations a month.',
    ],
    mostPopular: true,
  },
  {
    tier: 'pro',
    name: 'Pro',
    price: '₹1,299',
    limit: 'Unlimited games analysed',
    features: [
      'Everything intermediate gives, with no monthly cap.',
      'History across seasons: compare this season to the last.',
      'Unlimited coach explanations.',
    ],
  },
];

const PAYABLE_TIERS = new Set<Tier>(['intermediate', 'pro']);

function isPayable(tier: Tier): tier is PayableTier {
  return PAYABLE_TIERS.has(tier);
}

const TIER_LABEL: Record<Tier, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  pro: 'Pro',
};

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

function AlreadySubscribed({ tier }: { tier: Tier }) {
  return (
    <header className="space-y-4">
      <Heading level={1}>You are on the {TIER_LABEL[tier]} plan</Heading>
      <Badge label={TIER_LABEL[tier]} variant="neutral" />
      <Text as="p" display="block" type="supporting">
        {tier === 'pro'
          ? 'The full loop is already open, with no monthly cap: a focus, verification, the proof sheet, and history across seasons. Set a focus and check on it from your account.'
          : 'The full loop is already open, up to your monthly cap: a focus, verification, and the proof sheet. Set a focus and check on it from your account.'}
      </Text>
    </header>
  );
}

export function UpgradeRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const meQuery = useQuery(meQueryOptions());
  const [paying, setPaying] = useState<PayableTier | null>(null);
  const [payError, setPayError] = useState<PayError | null>(null);
  const [status, setStatus] = useState<'idle' | 'confirming' | 'processing'>('idle');

  async function confirmUpgrade(tier: PayableTier) {
    setStatus('confirming');
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      const me = await queryClient.fetchQuery(meQueryOptions());
      if (me.tier === tier) {
        track('converted_to_paid', { tier });
        await navigate({ to: '/settings' });
        return;
      }
      await delay(1500);
    }
    setStatus('processing');
  }

  async function handlePay(tier: PayableTier) {
    setPaying(tier);
    setPayError(null);

    let checkout: CheckoutResponse;
    try {
      checkout = await checkoutApi.checkout(tier);
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
          void confirmUpgrade(tier);
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

  if (meQuery.data?.tier !== undefined && isPayable(meQuery.data.tier)) {
    return <AlreadySubscribed tier={meQuery.data.tier} />;
  }

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <Heading level={1}>Choose a plan</Heading>
        <Text as="p" display="block" type="supporting">
          Your first diagnosis is free. The loop after it is paid.
        </Text>
      </header>

      <section aria-labelledby="plans-heading">
        <Heading level={2} id="plans-heading" className="sr-only">
          Plans
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
              Payment received. Your account has not updated yet. Refresh to see your new plan.
            </StatusMessage>
          </div>
        ) : null}
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {PLANS.map((plan) => {
            const payableTier = isPayable(plan.tier) ? plan.tier : null;
            return (
              <Card
                key={plan.tier}
                className={`flex flex-col p-6 ${plan.mostPopular === true ? 'border-2 border-accent' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <Heading level={3}>{plan.name}</Heading>
                  {plan.mostPopular === true ? (
                    <Badge label="Most popular" variant="orange" />
                  ) : null}
                </div>
                <div className="mt-3 flex items-baseline gap-1">
                  <Text
                    as="p"
                    display="block"
                    className="font-mono text-3xl leading-tight tracking-tight"
                  >
                    {plan.price}
                  </Text>
                  {plan.tier !== 'beginner' ? (
                    <Text as="p" display="block" type="supporting" className="text-sm">
                      /month
                    </Text>
                  ) : null}
                </div>
                <Text as="p" display="block" type="supporting" className="mt-1 text-sm">
                  {plan.limit}
                </Text>
                <ul className="mt-4 space-y-2 text-sm text-muted">
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                {payableTier !== null ? (
                  <Button
                    label={paying === payableTier ? 'Opening checkout...' : `Pay ${plan.price}`}
                    variant={plan.mostPopular === true ? 'primary' : 'secondary'}
                    onClick={() => void handlePay(payableTier)}
                    isDisabled={paying !== null || status !== 'idle'}
                    className="mt-6 min-h-11 press"
                  />
                ) : null}
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}

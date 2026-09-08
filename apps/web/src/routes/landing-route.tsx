import { lazy, Suspense } from 'react';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { useQuery } from '@tanstack/react-query';

import { Mark } from '../components/mark.tsx';
import { meQueryOptions } from '../query-client.ts';

// Lazy: importing `gsap` (via Hero/ValuePropsSection/useSmoothScroll/
// useScrollReveal) starts its ticker immediately, a perpetual
// requestAnimationFrame loop. Every other route eagerly imports this file
// through `router.tsx`, so keeping GSAP out of this module's top-level
// imports keeps its ticker out of every other route's bundle and test run.
const LandingContent = lazy(() =>
  import('../components/landing/landing-content.tsx').then((m) => ({
    default: m.LandingContent,
  })),
);

function LandingContentFallback() {
  return (
    <div
      role="status"
      aria-label="Loading"
      aria-busy="true"
      className="mx-auto w-full max-w-5xl space-y-3 px-4 py-16"
    >
      <div className="h-5 w-40 rounded-control bg-sunken" />
      <div className="h-4 w-64 rounded-control bg-sunken" />
    </div>
  );
}

export function LandingRoute() {
  const meQuery = useQuery(meQueryOptions());
  const signedIn = meQuery.isSuccess;
  return (
    <div className="flex min-h-screen flex-col font-ui text-primary">
      <div className="relative z-10 flex min-h-screen flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent focus:outline-none focus:ring-2 focus:ring-focus"
        >
          Skip to main content
        </a>

        <header className="glass-top sticky top-0 z-20 border-b border-border-subtle">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
            <span className="flex items-center gap-2">
              <Mark size={26} />
              <Text className="font-display text-xl leading-tight tracking-tight">Kanso Chess</Text>
            </span>
            {signedIn ? (
              <Link href="/report">Go to report</Link>
            ) : (
              <Link href="/sign-in">Sign in</Link>
            )}
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="flex-1">
          <Suspense fallback={<LandingContentFallback />}>
            <LandingContent signedIn={signedIn} />
          </Suspense>
        </main>

        <footer className="border-t border-border-subtle">
          <div className="mx-auto w-full max-w-5xl px-4 py-8">
            <p className="kicker">Kanso Chess</p>
            <Text as="p" display="block" type="supporting" className="mt-2 text-sm">
              Kanso Chess is tournament-first chess improvement for junior players and their
              coaches.
            </Text>
          </div>
        </footer>
      </div>
    </div>
  );
}

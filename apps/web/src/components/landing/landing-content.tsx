import { useRef } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Hero } from './hero.tsx';
import { TechnologySection } from './technology-section.tsx';
import { ValuePropsSection } from './value-props-section.tsx';
import { useScrollReveal } from '../../hooks/use-scroll-reveal.ts';
import { useSmoothScroll } from '../../hooks/use-smooth-scroll.ts';

interface LandingContentProps {
  signedIn: boolean;
}

/**
 * Everything below the header that GSAP and Lenis drive (ST-133), split
 * into its own lazy chunk from `landing-route.tsx`: importing `gsap` alone
 * starts its ticker (a perpetual `requestAnimationFrame` loop), and every
 * other route eagerly imports `router.tsx`, so keeping this out of that
 * module's top-level imports keeps the ticker out of every other route's
 * bundle and test run too.
 */
export function LandingContent({ signedIn }: LandingContentProps) {
  const ctaRef = useRef<HTMLDivElement | null>(null);
  useSmoothScroll();
  useScrollReveal(ctaRef);

  return (
    <>
      <Hero signedIn={signedIn} />

      <ValuePropsSection />

      <TechnologySection />

      <section className="relative flex flex-col justify-center overflow-x-clip border-t border-border-subtle">
        <div
          aria-hidden="true"
          className="lamp pointer-events-none absolute inset-x-0 top-0 mx-auto h-[360px] max-w-3xl"
        />
        <div className="relative mx-auto w-full max-w-5xl px-4 py-16 text-center md:py-24">
          <p className="kicker">03 · Begin</p>
          <Heading level={2} className="mt-3 text-3xl tracking-tight md:text-4xl">
            See what is actually costing you rating
          </Heading>
          <div ref={ctaRef} className="mt-10 flex flex-col items-center gap-3">
            {signedIn ? (
              <Button label="Go to report" href="/report" variant="primary" />
            ) : (
              <>
                <Button label="Get your free diagnosis" href="/sign-up" variant="primary" />
                <Button
                  label="Already have an account? Sign in"
                  href="/sign-in"
                  variant="secondary"
                />
              </>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

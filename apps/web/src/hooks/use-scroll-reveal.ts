import { useEffect, type RefObject } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  MOTION_DURATION,
  MOTION_EASE,
  STAGGER_STEP_CAP,
  STAGGER_STEP_SECONDS,
} from '../motion-tokens.ts';

gsap.registerPlugin(ScrollTrigger);

/**
 * Reveals a container's direct children in a capped stagger once the
 * container enters the viewport, the ScrollTrigger equivalent of the
 * `.stagger-in` CSS utility: the delay per item grows up to
 * `STAGGER_STEP_CAP` items, then holds, matching `.stagger-in`'s
 * `:nth-child(n + 7)` rule. Runs once per mount (`once: true`); a visitor
 * scrolling back up does not re-trigger it.
 *
 * Under `prefers-reduced-motion: reduce`, the end state is set immediately
 * with no ScrollTrigger and no tween, per the same rule the scrubbed and
 * pinned sequences elsewhere on the page follow.
 */
export function useScrollReveal(containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const targets = Array.from(container.children);
    if (targets.length === 0) return undefined;

    const media = gsap.matchMedia();
    media.add(
      {
        reduce: '(prefers-reduced-motion: reduce)',
        motion: '(prefers-reduced-motion: no-preference)',
      },
      (context) => {
        const { reduce } = context.conditions as { reduce: boolean };
        if (reduce) {
          gsap.set(targets, { opacity: 1, y: 0 });
          return undefined;
        }

        gsap.set(targets, { opacity: 0, y: 24 });
        const trigger = ScrollTrigger.create({
          trigger: container,
          start: 'top 80%',
          once: true,
          onEnter: () => {
            gsap.to(targets, {
              opacity: 1,
              y: 0,
              duration: MOTION_DURATION.slow,
              ease: MOTION_EASE.decelerate,
              stagger: (index: number) =>
                Math.min(index, STAGGER_STEP_CAP - 1) * STAGGER_STEP_SECONDS,
            });
          },
        });
        return () => trigger.kill();
      },
    );

    return () => media.revert();
  }, [containerRef]);
}

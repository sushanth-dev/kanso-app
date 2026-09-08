import { useLayoutEffect, type RefObject } from 'react';
import gsap from 'gsap';
import { MOTION_DURATION, MOTION_EASE } from './motion-tokens.ts';

/**
 * ST-139. The one mechanic behind the surface reveals, extracted from
 * ResultReveal when the focus verdict became its third caller: the figure
 * fades and rises on the slow decelerate token, the optional gloss line
 * follows a beat later on the same ease, and `clearProps` leaves no inline
 * styles behind at the settle. The accessible values live in sr-only spans
 * and the animated elements are aria-hidden on top of them, the dual-span
 * pattern ST-133 landed on the hero. `gsap.matchMedia` runs the timeline
 * only under standard motion; under reduced motion nothing animates and the
 * DOM's natural state, which is also the state before any JavaScript runs,
 * is the final state.
 */
export function useRevealSequence(
  figureRef: RefObject<HTMLElement | null>,
  glossRef: RefObject<HTMLElement | null>,
  deps: readonly unknown[],
): void {
  useLayoutEffect(() => {
    const figure = figureRef.current;
    if (figure === null) return undefined;
    const context = gsap.context(() => {
      const media = gsap.matchMedia();
      media.add(
        {
          reduce: '(prefers-reduced-motion: reduce)',
          motion: '(prefers-reduced-motion: no-preference)',
        },
        (mediaContext) => {
          const { reduce } = mediaContext.conditions as { reduce: boolean };
          if (reduce) return undefined;
          const timeline = gsap.timeline();
          timeline.from(figure, {
            opacity: 0,
            y: 6,
            duration: MOTION_DURATION.slow,
            ease: MOTION_EASE.decelerate,
            clearProps: 'opacity,transform',
          });
          const gloss = glossRef.current;
          if (gloss !== null) {
            timeline.from(
              gloss,
              {
                opacity: 0,
                y: 6,
                duration: MOTION_DURATION.base,
                ease: MOTION_EASE.decelerate,
                clearProps: 'opacity,transform',
              },
              '>0.08',
            );
          }
          return () => {
            timeline.kill();
          };
        },
      );
      return () => media.revert();
    });
    return () => context.revert();
    // The caller owns the beat's identity: the sequence reruns when the
    // content it reveals changes, not on every render.
  }, deps);
}

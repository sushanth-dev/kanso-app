import { useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

/**
 * Wires Lenis, the app's one smooth-scroll engine (ST-133), into GSAP's
 * ticker and ScrollTrigger: `lenis.raf` drives from `gsap.ticker` so no
 * second rAF loop competes with GSAP's own, and `ScrollTrigger.update` runs
 * on every Lenis scroll event. Measurements refresh once fonts and other
 * page resources have loaded, and both the ticker callback and the Lenis
 * instance are torn down on unmount.
 *
 * Skips constructing Lenis entirely under `prefers-reduced-motion: reduce`,
 * so a visitor who asked for less motion gets the browser's native scroll
 * rather than Lenis running with its effect suppressed after the fact.
 */
export function useSmoothScroll(): void {
  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return undefined;

    const lenis = new Lenis();
    lenis.on('scroll', () => ScrollTrigger.update());

    const tick = (time: number) => {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    const refresh = () => {
      lenis.resize();
      ScrollTrigger.refresh();
    };
    // document.fonts (the Font Loading API) is absent in some environments
    // (older browsers, jsdom in tests); fall back to an immediate refresh.
    if (document.fonts) {
      void document.fonts.ready.then(refresh);
    } else {
      refresh();
    }
    window.addEventListener('load', refresh);

    return () => {
      window.removeEventListener('load', refresh);
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, []);
}

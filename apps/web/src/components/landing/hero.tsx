/*
 * Direction contract (ST-148, replaces the ST-133 contract).
 *
 * THESIS: the landing proves the free thing by showing it - and under
 * Nocturne the proof now stands in the app's own world: the study after
 * dark, lit by one lamp. The focal asset is the real Board component
 * (product truth, never a mockup) holding the position before Morphy's
 * Opera Game queen sacrifice, the most famous attack in the literature;
 * the synthetic, labelled sample diagnosis card overlaps its edge, promise
 * and proof composed as one object. Ghost move notation - oversized IBM
 * Plex Mono at low alpha, aria-hidden - sets the typographic texture.
 *
 * OWN-WORLD: Nocturne tokens do the world-building (warm ink canvas, bone
 * type, ember accent, hairline elevation); this component owns the
 * composition: kicker, statement-scale Source Serif 4 headline, the lamp
 * glow (.lamp, the one narrative light source), the tilted board, the
 * overlapping diagnosis card.
 *
 * MOTION: GSAP drives an intro timeline scoped to this component
 * (`gsap.context`): the headline reveals word by word, then the copy, the
 * call to action, and the board group rise in behind it. After entrance,
 * the board group carries two additive motions, both whole-container
 * transforms - never the pieces (ADR-0017's spirit carried to marketing):
 * a pointer parallax (fine pointers only, quickTo, ±6°) and a scroll
 * parallax (ScrollTrigger scrub, 60px total). Lenis stays the page's one
 * smooth-scroll engine; nothing here scrolls on its own.
 *
 * REDUCED MOTION: `gsap.matchMedia()` keyed to
 * `(prefers-reduced-motion: reduce)` sets every element straight to its
 * end state with `gsap.set`, no tween, and builds neither the pointer nor
 * the scroll parallax.
 *
 * NO-JS: every element's hidden starting state is set by the effect, in
 * JS, never by a static class. With no JavaScript the DOM renders at its
 * natural opacity, in document order: a complete, readable first frame.
 *
 * ICONS: the one Solar icon on this page rides the call to action
 * (`arrow-right-linear`, via `unplugin-icons` + `@iconify-json/solar`,
 * composed through Astryx `Icon`'s existing component mode). It is
 * decorative next to a labelled button, so it carries no `label` prop.
 *
 * THREE.JS: none. The product's own board is the depth element; a shader
 * here would be ornamental under the skill's own purpose rule (and
 * ADR-0043's default).
 */
import { Fragment, useLayoutEffect, useRef } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import ArrowRightIcon from '~icons/solar/arrow-right-linear';
import {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_EASE_GSAP,
  STAGGER_STEP_SECONDS,
  STAGGER_STEP_CAP,
} from '../../motion-tokens.ts';
import { Board } from '../board.tsx';
import { ProductEvidence } from './product-evidence.tsx';

gsap.registerPlugin(ScrollTrigger);

const HEADLINE = 'Know the one thing to fix after every tournament.';
const HEADLINE_WORDS = HEADLINE.split(' ');

const SAMPLE_TOURNAMENT = 'A scholastic tournament · K-8 U1200 · 5 rounds';

// Morphy vs the Duke of Brunswick and Count Isouard, Paris 1858 - the Opera
// Game - after 15...Nxd7, white to move: the position before 16.Qb8+!! the
// most famous queen sacrifice in the literature. A real, public-domain
// position; the board renders it statically, never animated.
const HERO_FEN = '4k2r/p2n4/4q3/4p1B1/1Q2P3/8/PPP2PPP/2K5 w k - 0 16';
const HERO_BOARD_LABEL =
  "Position from Morphy's Opera Game, 1858. White to move, before the queen sacrifice 16 Qb8.";

interface SampleWeakness {
  rank: number;
  label: string;
  kind: 'Tactical motif' | 'Time trouble' | 'Opening';
  ratingLeak: number;
}

// Synthetic, labelled in the render. Numbers mirror the report's shape but are
// not any real player's diagnosis.
const SAMPLE_WEAKNESSES: SampleWeakness[] = [
  { rank: 1, label: 'Missing tactics in the middlegame', kind: 'Tactical motif', ratingLeak: 34 },
  { rank: 2, label: 'Time trouble from move 24', kind: 'Time trouble', ratingLeak: 21 },
  { rank: 3, label: 'Passive opening choices', kind: 'Opening', ratingLeak: 12 },
];

function SampleDiagnosis() {
  return (
    <Card className="w-full p-6">
      <Text as="p" display="block" type="supporting">
        Synthetic example
      </Text>
      <Text as="p" display="block" className="mt-2 text-xl leading-snug tracking-tight">
        {SAMPLE_TOURNAMENT}
      </Text>
      <ol className="mt-4">
        {SAMPLE_WEAKNESSES.map((weakness) => (
          <li
            key={weakness.rank}
            className="flex items-baseline gap-3 border-b border-border-subtle py-3 first:pt-0 last:border-b-0 last:pb-0"
          >
            <Text type="supporting" className="font-mono text-sm">
              #{weakness.rank}
            </Text>
            <span className="flex-1">
              <Text className="font-display text-base">{weakness.label}</Text>
              <Badge label={weakness.kind} variant="neutral" />
            </span>
            <Text className="font-mono text-base">{weakness.ratingLeak}</Text>
          </li>
        ))}
      </ol>
    </Card>
  );
}

interface HeroProps {
  signedIn: boolean;
}

export function Hero({ signedIn }: HeroProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const tiltRef = useRef<HTMLDivElement | null>(null);
  const wordRefs = useRef<HTMLSpanElement[]>([]);
  wordRefs.current = [];

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const context = gsap.context(() => {
      const media = gsap.matchMedia();

      // Entrance and pointer parallax share one conditioned context; the
      // scroll parallax runs in its own, so reduce builds neither.
      media.add(
        {
          reduce: '(prefers-reduced-motion: reduce)',
          motion: '(prefers-reduced-motion: no-preference)',
        },
        (mediaContext) => {
          const { reduce } = mediaContext.conditions as { reduce: boolean };
          const words = wordRefs.current;
          const rest = root.querySelectorAll<HTMLElement>('[data-hero-reveal]');
          const tilt = tiltRef.current;

          if (reduce) {
            gsap.set(words, { opacity: 1, y: 0 });
            gsap.set(rest, { opacity: 1, y: 0 });
            return undefined;
          }

          gsap.set(words, { opacity: 0, y: 12 });
          gsap.set(rest, { opacity: 0, y: 16 });

          const timeline = gsap.timeline();
          timeline
            .to(words, {
              opacity: 1,
              y: 0,
              duration: MOTION_DURATION.slow,
              ease: MOTION_EASE.decelerate,
              // Cap the per-word delay: past six steps the tail reads as
              // latency, not choreography (Emil's stagger guidance), so
              // words beyond the cap start with the last capped word.
              stagger: (index: number) =>
                Math.min(index, STAGGER_STEP_CAP - 1) * STAGGER_STEP_SECONDS,
            })
            .to(
              rest,
              {
                opacity: 1,
                y: 0,
                duration: MOTION_DURATION.base,
                ease: MOTION_EASE.decelerate,
                stagger: STAGGER_STEP_SECONDS,
              },
              '-=0.1',
            );

          // Pointer parallax: fine pointers only, additive, whole-container.
          if (tilt !== null && window.matchMedia('(pointer: fine)').matches) {
            const toRotationY = gsap.quickTo(tilt, 'rotationY', {
              duration: MOTION_DURATION.slow,
              ease: MOTION_EASE_GSAP,
            });
            const toRotationX = gsap.quickTo(tilt, 'rotationX', {
              duration: MOTION_DURATION.slow,
              ease: MOTION_EASE_GSAP,
            });
            const onMove = (event: PointerEvent) => {
              const rect = root.getBoundingClientRect();
              const across = (event.clientX - rect.left) / rect.width - 0.5;
              const down = (event.clientY - rect.top) / rect.height - 0.5;
              toRotationY(across * 6);
              toRotationX(-down * 4);
            };
            root.addEventListener('pointermove', onMove);
            return () => {
              root.removeEventListener('pointermove', onMove);
              timeline.kill();
            };
          }

          return () => timeline.kill();
        },
      );

      // Scroll parallax: the board sinks 60px as the hero leaves, the lamp's
      // light falling away with it. Scrubbed, so it never plays on its own.
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const tilt = tiltRef.current;
        if (tilt === null) return undefined;
        const tween = gsap.fromTo(
          tilt,
          { y: 30 },
          {
            y: -30,
            ease: 'none',
            scrollTrigger: {
              trigger: root,
              start: 'top top',
              end: 'bottom top',
              scrub: true,
            },
          },
        );
        return () => {
          tween.scrollTrigger?.kill();
          tween.kill();
        };
      });

      return () => media.revert();
    }, root);

    return () => context.revert();
  }, []);

  return (
    <section
      ref={rootRef}
      className="relative mx-auto w-full max-w-5xl overflow-x-clip px-4 pb-16 pt-12 md:pt-20"
    >
      {/* The one narrative light source: a lamp over the board. Decorative,
          aria-hidden, and never more than this hero and the closing CTA. */}
      <div
        aria-hidden="true"
        className="lamp pointer-events-none absolute inset-x-0 -top-20 mx-auto h-[480px] max-w-4xl"
      />
      <div className="relative grid gap-12 md:grid-cols-2 md:items-center md:gap-10">
        <div>
          <p data-hero-reveal className="kicker">
            AI chess training platform
          </p>
          <Heading
            level={1}
            className="mt-3 text-4xl font-semibold leading-tight tracking-tight md:text-5xl"
          >
            {/* The accessible name is the unsplit string; the word spans below
                are a decorative, aria-hidden duplicate the intro timeline
                animates. Both render identically with no JavaScript. */}
            <span className="sr-only">{HEADLINE}</span>
            <span aria-hidden="true">
              {HEADLINE_WORDS.map((word, index) => (
                <Fragment key={`${word}-${index}`}>
                  {/* The space rides outside the inline-block span: CSS
                      collapses trailing whitespace at an inline-block's box
                      edge, so a space inside it never renders. */}
                  <span
                    ref={(el) => {
                      if (el) wordRefs.current[index] = el;
                    }}
                    className="inline-block"
                  >
                    {word}
                  </span>
                  {index < HEADLINE_WORDS.length - 1 ? ' ' : null}
                </Fragment>
              ))}
            </span>
          </Heading>
          <div data-hero-reveal className="mt-6">
            <Text as="p" display="block" type="supporting" className="text-lg leading-base">
              Your first diagnosis is free. Import your games and get a ranked list of what is
              costing you rating, starting with the one thing to fix.
            </Text>
          </div>
          <div data-hero-reveal className="mt-4">
            <Text as="p" display="block" type="supporting">
              For parents, it makes every lesson you already pay for work harder.
            </Text>
          </div>
          <div data-hero-reveal className="mt-8">
            {signedIn ? (
              <Button label="Go to report" href="/report" variant="primary" />
            ) : (
              <Button
                label="Get your free diagnosis"
                href="/sign-up"
                variant="primary"
                endContent={<Icon icon={ArrowRightIcon} size="sm" />}
              />
            )}
          </div>
        </div>
        <div data-hero-reveal className="relative [perspective:1100px]">
          <div
            ref={tiltRef}
            className="relative [transform-style:preserve-3d] will-change-transform"
          >
            {/* Ghost notation: the move played from this position, as typographic
                texture. Decoration only - aria-hidden, unselectable. */}
            <div
              aria-hidden="true"
              className="ghost-notation pointer-events-none absolute -top-8 right-0 text-[clamp(3rem,8vw,6.5rem)] leading-none"
            >
              16.Qb8+!!
            </div>
            <div
              className="relative mx-auto max-w-[420px] [transform:rotateX(7deg)]"
              style={{ transformStyle: 'preserve-3d' }}
            >
              <Board fen={HERO_FEN} theme="wood" label={HERO_BOARD_LABEL} />
            </div>
            <div className="relative z-10 mx-auto -mt-14 max-w-[340px] px-2 [transform:translateZ(48px)] md:mt-0 md:px-0 lg:absolute lg:-bottom-12 lg:left-0 lg:max-w-[320px]">
              <SampleDiagnosis />
              <ProductEvidence />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

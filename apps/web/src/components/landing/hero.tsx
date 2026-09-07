/*
 * Direction contract (ST-133, replaces seed 4a5813cc).
 *
 * THESIS: the landing page still proves the free thing by showing it, the
 * one thesis sprint 12's coherence pass and this sprint's own audit both
 * confirmed still fits: a rendered ranked diagnosis, not a claim about one.
 * What changes is that the proof is now performed, not dropped in statically
 * - the visitor watches the headline resolve and the diagnosis assemble
 * itself, word by row, the same way a real report arrives.
 *
 * OWN-WORLD: Study Room, kept rather than replaced. A materially new palette
 * or type family for one page would strand every other route on the system
 * ST-071 through ST-104 spent nine stories tuning for contrast and the board
 * floor, and no new palette was briefed for this story. What is materially
 * new is the composition, the motion narrative, and the imagery-free,
 * data-led hero this story earns instead: Source Serif 4 display over Public
 * Sans, IBM Plex Mono for every number, warm paper, one terracotta accent,
 * flat tonal depth - all unchanged, all now choreographed.
 *
 * MOTION: GSAP drives an intro timeline scoped to this component
 * (`gsap.context`): the headline reveals word by word, then the subhead, the
 * parent line, and the call to action rise in behind it, then the sample
 * diagnosis card settles in last, proof arriving after promise. Durations and
 * eases are the same `--kanso-motion-duration-*`/`--kanso-motion-ease-*`
 * values the rest of the app's CSS motion already uses (see
 * `motion-tokens.ts`), so JS-driven and CSS-driven motion share one rhythm.
 * Lenis (`useSmoothScroll`, mounted once in `LandingRoute`) is the page's one
 * smooth-scroll engine; nothing in this component drives scroll itself.
 *
 * REDUCED MOTION: `gsap.matchMedia()` keyed to
 * `(prefers-reduced-motion: reduce)` sets every element straight to its end
 * state with `gsap.set`, no tween, matching the rule the scrubbed sequences
 * elsewhere on the page follow.
 *
 * NO-JS: every element's hidden starting state is set by the effect, in JS,
 * never by a static class. With no JavaScript the DOM renders at its natural
 * opacity, in document order: a complete, readable first frame.
 *
 * ICONS: the one Solar icon on this page rides the call to action
 * (`arrow-right-linear`, via `unplugin-icons` + `@iconify-json/solar`,
 * composed through Astryx `Icon`'s existing component mode). It is
 * decorative next to a labelled button, so it carries no `label` prop.
 *
 * THREE.JS: none. No effect here earns a custom WebGL scene under the
 * skill's own rule; the default the skill and ADR-0043 both state is that it
 * stays absent, and nothing found in writing this hero overrides that.
 */
import { Fragment, useLayoutEffect, useRef } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import gsap from 'gsap';
import ArrowRightIcon from '~icons/solar/arrow-right-linear';
import { MOTION_DURATION, MOTION_EASE, STAGGER_STEP_SECONDS } from '../../motion-tokens.ts';

const HEADLINE = 'Know the one thing to fix after every tournament.';
const HEADLINE_WORDS = HEADLINE.split(' ');

const SAMPLE_TOURNAMENT = 'A scholastic tournament · K-8 U1200 · 5 rounds';

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
    <Card className="w-full p-6 shadow-[0_24px_48px_-24px_rgba(61,40,20,0.45)]">
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
  const wordRefs = useRef<HTMLSpanElement[]>([]);
  wordRefs.current = [];

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const context = gsap.context(() => {
      const media = gsap.matchMedia();
      media.add(
        {
          reduce: '(prefers-reduced-motion: reduce)',
          motion: '(prefers-reduced-motion: no-preference)',
        },
        (mediaContext) => {
          const { reduce } = mediaContext.conditions as { reduce: boolean };
          const words = wordRefs.current;
          const rest = root.querySelectorAll<HTMLElement>('[data-hero-reveal]');

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
              stagger: STAGGER_STEP_SECONDS,
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

          return () => timeline.kill();
        },
      );

      return () => media.revert();
    }, root);

    return () => context.revert();
  }, []);

  return (
    <section
      ref={rootRef}
      className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-4 py-16 md:py-24"
    >
      <div className="grid gap-10 md:grid-cols-2 md:items-center md:gap-12">
        <div>
          <Heading level={1} className="text-3xl leading-tight tracking-tight md:text-4xl">
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
          <div data-hero-reveal className="mt-4">
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
        <div data-hero-reveal>
          <SampleDiagnosis />
        </div>
      </div>
    </section>
  );
}

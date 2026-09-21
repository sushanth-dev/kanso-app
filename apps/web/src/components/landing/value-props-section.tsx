import { useRef } from 'react';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { useScrollReveal } from '../../hooks/use-scroll-reveal.ts';

interface ValueProp {
  title: string;
  body: string;
}

const VALUE_PROPS: ValueProp[] = [
  {
    title: 'Your tournament is a first-class object.',
    body: 'Not a filter on a stream of online games. A tournament has a name, a date, a section, and five to nine classical games, and that is how a junior, a coach, and a parent already think.',
  },
  {
    title: 'Games arrive without typing.',
    body: 'Import from Chess.com or Lichess by username, or upload a PGN. No retyping nine handwritten scoresheets.',
  },
  {
    title: 'Verification is two-speed, and says which speed it is.',
    body: 'Blitz is the fast signal, on your opening and endgame. Your next tournament is the proof.',
  },
];

/**
 * The value proposition and the free/paid boundary, each revealing on scroll
 * (`useScrollReveal`, the ScrollTrigger equivalent of `.stagger-in`) rather
 * than sitting statically on the page. Still plain headings, never
 * icon-and-heading cards, per this section's own long-standing rule.
 */
export function ValuePropsSection() {
  const propsRef = useRef<HTMLDivElement | null>(null);
  const boundaryRef = useRef<HTMLDivElement | null>(null);
  useScrollReveal(propsRef);
  useScrollReveal(boundaryRef);

  return (
    <section className="flex flex-col justify-center border-t border-border-subtle">
      <div className="mx-auto w-full max-w-5xl px-4 py-16 md:py-24">
        <p className="kicker">01 · The idea</p>
        <Heading level={2} className="mt-3 text-3xl tracking-tight md:text-4xl">
          What Kanso does
        </Heading>
        <div ref={propsRef} className="mt-10 grid gap-10 md:grid-cols-3">
          {VALUE_PROPS.map((prop, index) => (
            <div key={prop.title}>
              <Text as="p" display="block" type="supporting" className="font-mono text-sm">
                {String(index + 1).padStart(2, '0')}
              </Text>
              <Heading level={3} className="mt-2 text-lg leading-snug">
                {prop.title}
              </Heading>
              <Text as="p" display="block" type="supporting" className="mt-2">
                {prop.body}
              </Text>
            </div>
          ))}
        </div>

        <div
          ref={boundaryRef}
          className="mt-16 grid gap-10 border-t border-border-subtle pt-10 md:grid-cols-2"
        >
          <div>
            <Heading level={3} className="text-lg leading-snug">
              Free today
            </Heading>
            <Text as="p" display="block" type="supporting" className="mt-2">
              Import from Chess.com or Lichess by username, or upload a PGN. Get one ranked
              diagnosis, with the rating-leak number for your top weakness.
            </Text>
          </div>
          <div>
            <Heading level={3} className="text-lg leading-snug">
              Paid for the loop
            </Heading>
            <Text as="p" display="block" type="supporting" className="mt-2">
              Everything after the diagnosis: a focus, verification of whether it worked, and a
              proof sheet to send your parents. From ₹799 a month, uncapped on the Pro plan.
            </Text>
          </div>
        </div>
      </div>
    </section>
  );
}

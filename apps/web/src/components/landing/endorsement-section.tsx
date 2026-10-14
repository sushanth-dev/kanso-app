import { useRef } from 'react';
import { Text } from '@astryxdesign/core/Text';
import { useScrollReveal } from '../../hooks/use-scroll-reveal.ts';

export const ENDORSEMENT = {
  quote: 'I checked it with some of my games and it does give valuable information.',
  author: 'GM Alex Colovic',
  title: 'Grandmaster',
} as const;

/**
 * Verified endorsement from Grandmaster Alex Colovic (ST-180).
 * Displays his approved quote verbatim under Nocturne tokens,
 * revealing on scroll via useScrollReveal.
 */
export function EndorsementSection() {
  const quoteRef = useRef<HTMLQuoteElement | null>(null);
  useScrollReveal(quoteRef);

  return (
    <section
      aria-label="Endorsement"
      className="flex flex-col justify-center border-t border-border-subtle"
    >
      <div className="mx-auto w-full max-w-5xl px-4 py-16 text-center md:py-20">
        <blockquote ref={quoteRef} className="mx-auto max-w-2xl">
          <p className="font-display text-2xl leading-snug tracking-tight text-primary md:text-3xl">
            &ldquo;{ENDORSEMENT.quote}&rdquo;
          </p>
          <footer className="mt-6">
            <cite className="not-italic">
              <Text as="span" display="inline" className="font-medium text-primary">
                {ENDORSEMENT.author}
              </Text>
              <Text as="span" display="inline" type="supporting" className="text-sm">
                {' '}
                · {ENDORSEMENT.title}
              </Text>
            </cite>
          </footer>
        </blockquote>
      </div>
    </section>
  );
}

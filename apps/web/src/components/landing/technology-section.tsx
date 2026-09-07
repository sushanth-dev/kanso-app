import { useRef } from 'react';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { useScrollReveal } from '../../hooks/use-scroll-reveal.ts';

interface TechNote {
  title: string;
  body: string;
}

const TECH_NOTES: TechNote[] = [
  {
    title: 'Stockfish checks every move.',
    body: 'The open-source chess engine runs against every imported game, the same analysis a titled coach would reach for.',
  },
  {
    title: 'GLM-5.3-Flash writes the coaching.',
    body: 'Each explanation behind a ranked weakness is generated fresh, not pulled from a canned script.',
  },
  {
    title: 'Lichess, the open platform.',
    body: 'Ratings and game imports reach Lichess directly, the same open-source platform the games themselves are played on.',
  },
];

/**
 * The fourth landing section, naming the tools behind the diagnosis. Plain
 * headings only, matching `ValuePropsSection`'s own rule against
 * icon-and-heading cards: real company marks (Iconify's `Logos` set) are not
 * installed, so this stays text-only rather than adding a dependency for a
 * name-check.
 */
export function TechnologySection() {
  const notesRef = useRef<HTMLDivElement | null>(null);
  useScrollReveal(notesRef);

  return (
    <section className="glass flex min-h-screen flex-col justify-center border-t border-border-subtle">
      <div className="mx-auto w-full max-w-5xl px-4 py-16">
        <Heading level={2} className="text-2xl tracking-tight">
          The technology behind it
        </Heading>
        <div ref={notesRef} className="mt-8 grid gap-8 md:grid-cols-3">
          {TECH_NOTES.map((note) => (
            <div key={note.title}>
              <Heading level={3} className="text-lg leading-snug">
                {note.title}
              </Heading>
              <Text as="p" display="block" type="supporting" className="mt-2">
                {note.body}
              </Text>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

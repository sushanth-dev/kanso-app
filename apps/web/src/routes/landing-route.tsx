/*
 * Direction contract (seed 4a5813cc).
 *
 * THESIS: the landing page proves the free thing by showing it. The first
 * viewport is a rendered ranked diagnosis, not a claim about one. It refuses
 * the category-default headline plus three feature cards plus CTA scaffold.
 *
 * OWN-WORLD: Study Room. Warm paper page, raised card, ink, one terracotta
 * accent. Source Serif 4 display over Public Sans, IBM Plex Mono for every
 * number. Flat tonal depth, no shadows, no kickers, no section numbers, no
 * icon-and-heading card grid.
 *
 * STORY: a visitor reads the promise, sees a real ranked diagnosis, learns it
 * is free today and paid for the loop, and joins.
 *
 * FIRST VIEWPORT: two columns. Left: display headline, free-promise subhead,
 * the parent line, the primary call to action. Right: a raised card labelled
 * Synthetic example holding a named tournament and a three-row ranked
 * weakness list, rank and rating leak in mono.
 *
 * FORM: diagnosis-first hero, candidate 4 of 7, seed key 4a5813cc.
 *
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, and DESIGN.md.
 */
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { ParallaxPiece } from '../components/parallax-piece.tsx';

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

const VALUE_PROPS = [
  {
    title: 'Your tournament is a first-class object.',
    body: 'Not a filter on a stream of online games. A tournament has a name, a date, a section, and five to nine classical games, and that is how a junior, a coach, and a parent already think.',
  },
  {
    title: 'Games arrive without typing.',
    body: 'Upload a PGN, or import a published tournament by name and player. No retyping nine handwritten scoresheets.',
  },
  {
    title: 'Verification is two-speed, and says which speed it is.',
    body: 'Blitz is the fast signal, on your opening and endgame. Your next tournament is the proof.',
  },
];

function SampleDiagnosis() {
  return (
    <Card className="w-full p-6 shadow-[0_24px_48px_-24px_rgba(61,40,20,0.45)] reveal-in">
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

export function LandingRoute() {
  return (
    <div className="flex min-h-screen flex-col font-ui text-primary">
      <ParallaxPiece />
      <div className="relative z-10 flex min-h-screen flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent focus:outline-none focus:ring-2 focus:ring-focus"
        >
          Skip to main content
        </a>

        <header className="glass sticky top-0 z-20 border-b border-border-subtle">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-control bg-accent" />
              <Text className="font-display text-xl leading-tight tracking-tight">Kanso Chess</Text>
            </span>
            <Link href="/sign-in">Sign in</Link>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="flex-1">
          <section className="mx-auto w-full max-w-5xl px-4 py-16 md:py-24">
            <div className="grid gap-10 md:grid-cols-2 md:items-center md:gap-12">
              <div>
                <Heading level={1} className="text-3xl leading-tight tracking-tight md:text-4xl">
                  Know the one thing to fix after every tournament.
                </Heading>
                <Text
                  as="p"
                  display="block"
                  type="supporting"
                  className="mt-4 text-lg leading-base"
                >
                  Your first diagnosis is free. Import your games and get a ranked list of what is
                  costing you rating, starting with the one thing to fix.
                </Text>
                <Text as="p" display="block" type="supporting" className="mt-4">
                  For parents, it makes every lesson you already pay for work harder.
                </Text>
                <div className="mt-8">
                  <Button label="Get your free diagnosis" href="/sign-up" variant="primary" />
                </div>
              </div>
              <SampleDiagnosis />
            </div>
          </section>

          <section className="glass border-t border-border-subtle">
            <div className="mx-auto w-full max-w-5xl px-4 py-16">
              <Heading level={2} className="text-2xl tracking-tight">
                What Kanso does
              </Heading>
              <div className="mt-8 grid gap-8 md:grid-cols-3">
                {VALUE_PROPS.map((prop) => (
                  <div key={prop.title}>
                    <Heading level={3} className="text-lg leading-snug">
                      {prop.title}
                    </Heading>
                    <Text as="p" display="block" type="supporting" className="mt-2">
                      {prop.body}
                    </Text>
                  </div>
                ))}
              </div>

              <div className="mt-14 grid gap-8 border-t border-border-subtle pt-8 md:grid-cols-2">
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
                    Everything after the diagnosis: a focus, verification of whether it worked, and
                    a proof sheet to send your parents. From ₹799 a month, uncapped on the Pro plan.
                  </Text>
                </div>
              </div>
            </div>
          </section>

          <section className="glass border-t border-border-subtle">
            <div className="mx-auto w-full max-w-5xl px-4 py-16 text-center">
              <Heading level={2} className="text-2xl tracking-tight">
                See what is actually costing you rating
              </Heading>
              <div className="mt-8 flex flex-col items-center gap-3">
                <Button label="Get your free diagnosis" href="/sign-up" variant="primary" />
                <Button
                  label="Already have an account? Sign in"
                  href="/sign-in"
                  variant="secondary"
                />
              </div>
            </div>
          </section>
        </main>

        <footer className="glass border-t border-border-subtle">
          <Text
            as="p"
            display="block"
            type="supporting"
            className="mx-auto w-full max-w-5xl px-4 py-6 text-sm"
          >
            Kanso Chess is tournament-first chess improvement for junior players and their coaches.
          </Text>
        </footer>
      </div>
    </div>
  );
}

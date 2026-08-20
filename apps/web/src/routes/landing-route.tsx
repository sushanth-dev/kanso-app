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
import { Card } from '@astryxdesign/core/Card';
import { Link } from '@tanstack/react-router';
import { secondaryLinkClassName } from '../components/secondary-link.ts';
import { primaryLinkClassName } from '../components/primary-link.ts';
import { ParallaxPiece } from '../components/parallax-piece.tsx';

const textLinkClassName =
  'inline-flex min-h-11 items-center font-ui text-accent underline underline-offset-2 transition-control hover:text-accent-hover';

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
    <Card className="w-full p-6 reveal-in">
      <p className="text-sm text-muted">Synthetic example</p>
      <p className="mt-2 font-display text-xl leading-snug tracking-tight">{SAMPLE_TOURNAMENT}</p>
      <ol className="mt-4">
        {SAMPLE_WEAKNESSES.map((weakness) => (
          <li
            key={weakness.rank}
            className="flex items-baseline gap-3 border-b border-border-subtle py-3 first:pt-0 last:border-b-0 last:pb-0"
          >
            <span className="font-mono text-sm text-muted">#{weakness.rank}</span>
            <span className="flex-1">
              <span className="font-display text-base">{weakness.label}</span>
              <Badge label={weakness.kind} variant="neutral" />
            </span>
            <span className="font-mono text-base">{weakness.ratingLeak}</span>
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

        <header className="border-b border-border-subtle bg-page">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-control bg-accent" />
              <span className="font-display text-xl leading-tight tracking-tight">Kanso Chess</span>
            </span>
            <Link to="/sign-in" className={textLinkClassName}>
              Sign in
            </Link>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="flex-1">
          <section className="mx-auto w-full max-w-5xl px-4 py-16 md:py-24">
            <div className="grid gap-10 md:grid-cols-2 md:items-center md:gap-12">
              <div>
                <h1 className="font-display text-3xl leading-tight tracking-tight md:text-4xl">
                  Know the one thing to fix after every tournament.
                </h1>
                <p className="mt-4 text-lg leading-base text-muted">
                  Your first diagnosis is free. Import your games and get a ranked list of what is
                  costing you rating, starting with the one thing to fix.
                </p>
                <p className="mt-4 text-muted">
                  For parents, it makes every lesson you already pay for work harder.
                </p>
                <div className="mt-8">
                  <Link to="/sign-up" className={primaryLinkClassName}>
                    Get your free diagnosis
                  </Link>
                </div>
              </div>
              <SampleDiagnosis />
            </div>
          </section>

          <section className="border-t border-border-subtle bg-page">
            <div className="mx-auto w-full max-w-5xl px-4 py-16">
              <h2 className="font-display text-2xl tracking-tight">What Kanso does</h2>
              <div className="mt-8 grid gap-8 md:grid-cols-3">
                {VALUE_PROPS.map((prop) => (
                  <div key={prop.title}>
                    <h3 className="font-display text-lg leading-snug">{prop.title}</h3>
                    <p className="mt-2 text-muted">{prop.body}</p>
                  </div>
                ))}
              </div>

              <div className="mt-14 grid gap-8 border-t border-border-subtle pt-8 md:grid-cols-2">
                <div>
                  <h3 className="font-display text-lg leading-snug">Free today</h3>
                  <p className="mt-2 text-muted">
                    Import from Chess.com or Lichess by username, or upload a PGN. Get one ranked
                    diagnosis, with the rating-leak number for your top weakness.
                  </p>
                </div>
                <div>
                  <h3 className="font-display text-lg leading-snug">Paid for the loop</h3>
                  <p className="mt-2 text-muted">
                    Everything after the diagnosis: a focus, verification of whether it worked, a
                    proof sheet to send your parents, history across seasons, and unlimited imports.
                    $15 a month, $130 a season, or $150 a year.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="border-t border-border-subtle bg-page">
            <div className="mx-auto w-full max-w-5xl px-4 py-16 text-center">
              <h2 className="font-display text-2xl tracking-tight">
                See what is actually costing you rating
              </h2>
              <div className="mt-8 flex flex-col items-center gap-3">
                <Link to="/sign-up" className={primaryLinkClassName}>
                  Get your free diagnosis
                </Link>
                <Link to="/sign-in" className={secondaryLinkClassName}>
                  Already have an account? Sign in
                </Link>
              </div>
            </div>
          </section>
        </main>

        <footer className="border-t border-border-subtle bg-page">
          <div className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-muted">
            Kanso Chess is tournament-first chess improvement for junior players and their coaches.
          </div>
        </footer>
      </div>
    </div>
  );
}

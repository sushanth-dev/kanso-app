import { useEffect } from 'react';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';

import { Mark } from '../components/mark.tsx';
import { SiteFooter } from '../components/site-footer.tsx';
import { LEGAL_UPDATED, type LegalBlock, type LegalPage } from '../content/legal/index.ts';
import { ABOUT_PAGE } from '../content/legal/about.ts';
import { CONTACT_PAGE } from '../content/legal/contact.ts';
import { LICENCES_PAGE } from '../content/legal/licences.ts';
import { PRIVACY_PAGE } from '../content/legal/privacy.ts';
import { TERMS_PAGE } from '../content/legal/terms.ts';

/** An ISO date as the version line reads it, in UTC so it never shifts a day. */
function formatUpdated(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Sets the document title and the description for a page.
 *
 * The title convention (`<page> · Kanso Chess`, restored on unmount) is the one
 * the shared routes already use. These pages set a description as well because
 * they are the pages a search result or a link preview reads a summary from,
 * and nothing else in the application sets one.
 */
function useLegalMeta(page: LegalPage) {
  useEffect(() => {
    document.title = `${page.title} · Kanso Chess`;
    const meta = document.createElement('meta');
    meta.name = 'description';
    meta.content = page.description;
    document.head.append(meta);
    return () => {
      document.title = 'Kanso Chess';
      meta.remove();
    };
  }, [page]);
}

function LegalBlocks({ blocks }: { blocks: LegalBlock[] }) {
  return blocks.map((block) =>
    typeof block === 'string' ? (
      <Text key={block} as="p" display="block" className="mt-3">
        {block}
      </Text>
    ) : (
      <ul key={block[0]} className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted">
        {block.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    ),
  );
}

/**
 * The policy pages and the licence notices share one layout: their own wordmark
 * header, the page as sections, and the site footer.
 *
 * They render outside the shell, like the landing page, because a page like this
 * is read by a visitor with no session and by a parent who has never signed in.
 * The bypass for their paths is in `RootComponent`.
 *
 * The kicker and the version date come from the page and fall back to what the
 * four policy pages carry, so only the notices page states either.
 */
function LegalScreen({ page }: { page: LegalPage }) {
  useLegalMeta(page);
  return (
    <div className="flex min-h-screen flex-col font-ui text-primary">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent focus:outline-none focus:ring-2 focus:ring-focus"
      >
        Skip to main content
      </a>

      <header className="glass-top sticky top-0 z-20 border-b border-border-subtle">
        <div className="mx-auto flex w-full max-w-5xl items-center px-4 py-4">
          <Link href="/" className="flex items-center gap-2">
            <Mark size={26} />
            <Text className="font-display text-xl leading-tight tracking-tight">Kanso Chess</Text>
          </Link>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
        <p className="kicker">{page.kicker ?? 'Policy'}</p>
        <Heading level={1} className="mt-2">
          {page.heading}
        </Heading>
        <Text as="p" display="block" className="mt-4 text-lg">
          {page.summary}
        </Text>
        <Text as="p" display="block" type="supporting" className="mt-3 text-sm">
          Last updated {formatUpdated(page.updated ?? LEGAL_UPDATED)}. A change to this page is
          announced by that date.
        </Text>

        {page.sections.map((section) => (
          <section key={section.heading} className="mt-10">
            <Heading level={2} className="text-xl">
              {section.heading}
            </Heading>
            <LegalBlocks blocks={section.blocks} />
          </section>
        ))}

        {page !== CONTACT_PAGE ? (
          <Text as="p" display="block" className="mt-10">
            Questions about this page go to{' '}
            <Link hasUnderline href="/contact">
              the contact page
            </Link>
            .
          </Text>
        ) : null}
      </main>

      <SiteFooter />
    </div>
  );
}

export function PrivacyRoute() {
  return <LegalScreen page={PRIVACY_PAGE} />;
}

export function TermsRoute() {
  return <LegalScreen page={TERMS_PAGE} />;
}

export function AboutRoute() {
  return <LegalScreen page={ABOUT_PAGE} />;
}

export function ContactRoute() {
  return <LegalScreen page={CONTACT_PAGE} />;
}

export function LicencesRoute() {
  return <LegalScreen page={LICENCES_PAGE} />;
}

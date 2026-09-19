/**
 * The four policy pages (ST-165) and the licence notices (ST-170), as content
 * rather than JSX.
 *
 * Each page is a module of sections, so a wording change is a readable diff and
 * they share one rendering path, which is also where the version date and the
 * section styling live.
 *
 * The policy copy is our own draft, written from what the code does. It is not
 * legal advice, and the pull request that added it names what a lawyer should
 * read first. The licence text on the notices page is not our draft: it is the
 * licence, reproduced so that it travels with the font files a reader fetches
 * from our own origin.
 */

/** A paragraph (a string) or a list (an array of strings), in order. */
export type LegalBlock = string | string[];

/** One headed block of a page. */
export interface LegalSection {
  heading: string;
  blocks: LegalBlock[];
}

export interface LegalPage {
  /** The document title, without the site suffix. */
  title: string;
  /** The meta description, one sentence. */
  description: string;
  /** The h1. */
  heading: string;
  /** The lead paragraph under the heading. */
  summary: string;
  sections: LegalSection[];
  /**
   * The small line above the h1. Defaults to "Policy", which the four policy
   * pages carry; the notices page says what it holds instead.
   */
  kicker?: string;
  /**
   * The date the page announces. Defaults to `LEGAL_UPDATED`, which the four
   * policy pages share because a change to any one of them is announced by
   * that one date. The notices change on their own schedule, when something we
   * ship changes licence, so they carry their own.
   */
  updated?: string;
}

/**
 * The one published address. It takes support, privacy requests, billing
 * questions, and consent-link problems, and a person reads it.
 */
export const CONTACT_EMAIL = 'hello@kansochess.app';

/** The version date the four policy pages carry. The layout renders it. */
export const LEGAL_UPDATED = '2026-09-18';

/** The five pages, in footer order. The hrefs are the router's paths. */
export const LEGAL_LINKS: { label: string; href: string }[] = [
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' },
  { label: 'Licences', href: '/licences' },
];

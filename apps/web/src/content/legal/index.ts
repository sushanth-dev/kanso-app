/**
 * The four policy pages (ST-165), as content rather than JSX.
 *
 * Each page is a module of sections, so a wording change is a readable diff and
 * the four share one rendering path, which is also where the version date and
 * the section styling live.
 *
 * The copy is our own draft, written from what the code does. It is not legal
 * advice, and the pull request that added it names what a lawyer should read
 * first.
 */

/** A paragraph (a string) or a list (an array of strings), in order. */
export type LegalBlock = string | string[];

/** One headed block of a policy page. */
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
}

/**
 * The one published address. It takes support, privacy requests, billing
 * questions, and consent-link problems, and a person reads it.
 */
export const CONTACT_EMAIL = 'hello@kansochess.app';

/** The version date all four pages carry. The layout renders it. */
export const LEGAL_UPDATED = '2026-09-18';

/** The four pages, in footer order. The hrefs are the router's paths. */
export const LEGAL_LINKS: { label: string; href: string }[] = [
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' },
];

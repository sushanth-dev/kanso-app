import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { LEGAL_LINKS } from '../content/legal/index.ts';

const SOCIAL_LINKS: { label: string; href: string }[] = [
  { label: 'Instagram', href: 'https://www.instagram.com/sushanth.kamabathula' },
  { label: 'GitHub', href: 'https://github.com/sushanth-dev' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/sushanth-kamabathula-247468344/' },
];

/**
 * The footer the public surfaces share (ST-165): the landing page, the sign-in
 * and sign-up screens, the policy pages, and the licence notices (ST-170). It
 * carries the only visible route to those pages, the sentence the landing
 * page has always ended on, and the builder credit with social links.
 *
 * The sentence is unchanged here on purpose. What the landing page says the
 * product is belongs to ST-167, which runs after ST-165 in the sprint stack.
 *
 * No outer margin: each placement carries its own spacing, so the landing page
 * keeps the layout it has.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-border-subtle">
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <p className="kicker">Kanso Chess</p>
        <Text as="p" display="block" type="supporting" className="mt-2 text-sm">
          Kanso Chess is an AI chess training platform for junior players and their coaches, with
          Stockfish analysis and AI coaching.
        </Text>
        <nav aria-label="Policy pages" className="mt-4">
          <ul className="flex flex-wrap gap-x-6">
            {LEGAL_LINKS.map((link) => (
              <li key={link.href}>
                <Link hasUnderline href={link.href} className="inline-flex min-h-11 items-center">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-4 flex flex-wrap items-center gap-x-6">
          <Text as="span" display="block" type="supporting" className="text-sm">
            Built by Sushanth Kamabathula
          </Text>
          <nav aria-label="Social links">
            <ul className="flex flex-wrap gap-x-6">
              {SOCIAL_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    hasUnderline
                    href={link.href}
                    isExternalLink
                    className="inline-flex min-h-11 items-center"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </footer>
  );
}

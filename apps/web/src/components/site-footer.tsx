import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { LEGAL_LINKS } from '../content/legal/index.ts';

/**
 * The footer the public surfaces share (ST-165): the landing page, the sign-in
 * and sign-up screens, and the four policy pages. It carries the only visible
 * route to the policy pages, and the sentence the landing page has always
 * ended on.
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
          Kanso Chess is tournament-first chess improvement for junior players and their coaches.
        </Text>
        <nav aria-label="Policy pages" className="mt-4">
          <ul className="flex flex-wrap gap-x-6">
            {LEGAL_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="inline-flex min-h-11 items-center">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}

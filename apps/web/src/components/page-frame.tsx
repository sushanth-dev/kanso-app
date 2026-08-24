import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from '@tanstack/react-router';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { StatusMessage, useStatusMessage } from './status-message.tsx';

export interface PageFrameProps {
  children: ReactNode;
}

type NavLeaf = { label: string; to: string };
type NavGroup = { label: string; items: NavLeaf[] };
type NavEntry = NavLeaf | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return (entry as NavGroup).items !== undefined;
}

// One source of truth for the nav. ST-088 will drop the Account leaf once the
// account page merges into settings; removing one entry is a one-line change.
const NAV_ENTRIES: NavEntry[] = [
  { label: 'Account', to: '/account' },
  {
    label: 'Progress',
    items: [
      { label: 'Report', to: '/account/report' },
      { label: 'Focus', to: '/account/focus' },
      { label: 'Proof sheet', to: '/account/proof-sheet' },
    ],
  },
  {
    label: 'Games',
    items: [
      { label: 'Games', to: '/account/games' },
      { label: 'Import', to: '/account/import' },
    ],
  },
  { label: 'Plans', to: '/account/upgrade' },
  { label: 'Settings', to: '/account/settings' },
];

function navEntryKey(entry: NavEntry): string {
  return isGroup(entry) ? entry.label : entry.to;
}

export function PageFrame({ children }: PageFrameProps) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { flash, markPresented, clearMessage } = useStatusMessage();
  const atDestination = flash !== null && pathname === flash.destination;
  const showNav = pathname === '/account' || pathname.startsWith('/account/');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (flash === null) return;
    if (pathname === flash.destination) {
      if (!flash.presented) markPresented();
    } else if (flash.presented) {
      clearMessage();
    }
  }, [clearMessage, flash, markPresented, pathname]);

  // Close the mobile menu on route change so a navigated-to page does not
  // render behind a stale open panel.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col font-ui">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent focus:outline-none focus:ring-2 focus:ring-focus"
      >
        Skip to main content
      </a>
      <header className="glass sticky top-0 z-20 border-b border-border-subtle">
        <div className="mx-auto w-full max-w-3xl px-4 py-4">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-control bg-accent" />
            <Text className="font-display text-xl leading-tight tracking-tight">Kanso Chess</Text>
            {showNav ? (
              <>
                {/* Desktop: same row as the wordmark. */}
                <nav aria-label="Account" className="ml-auto hidden md:block">
                  <ul className="flex flex-row flex-nowrap gap-1">
                    {NAV_ENTRIES.map((entry) => (
                      <li key={navEntryKey(entry)} className="relative">
                        {isGroup(entry) ? (
                          <NavGroupDesktop group={entry} pathname={pathname} />
                        ) : (
                          <NavLinkLeaf leaf={entry} pathname={pathname} />
                        )}
                      </li>
                    ))}
                  </ul>
                </nav>
                <IconButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto md:hidden"
                  label={mobileOpen ? 'Close menu' : 'Open menu'}
                  icon={<Icon icon={mobileOpen ? 'close' : 'menu'} size="sm" />}
                  aria-expanded={mobileOpen}
                  aria-controls="account-nav"
                  onClick={() => setMobileOpen((open) => !open)}
                />
              </>
            ) : null}
          </div>
          {showNav && mobileOpen ? (
            <nav aria-label="Account" id="account-nav" className="mt-2 md:hidden">
              <ul className="flex flex-col gap-1">
                {NAV_ENTRIES.map((entry) => (
                  <li key={navEntryKey(entry)}>
                    {isGroup(entry) ? (
                      <NavGroupMobile group={entry} pathname={pathname} />
                    ) : (
                      <NavLinkLeaf leaf={entry} pathname={pathname} block />
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        {atDestination ? (
          <div className="mb-6">
            <StatusMessage tone="success">{flash.message}</StatusMessage>
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}

interface NavLinkLeafProps {
  leaf: NavLeaf;
  pathname: string;
  block?: boolean;
}

function NavLinkLeaf({ leaf, pathname, block }: NavLinkLeafProps) {
  const active = pathname === leaf.to;
  return (
    <Link
      href={leaf.to}
      aria-current={active ? 'page' : undefined}
      className={[
        'inline-flex min-h-11 items-center rounded-control px-3 py-2 text-sm text-accent transition-colors',
        'hover:bg-overlay-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
        active ? 'font-semibold' : '',
        block ? 'w-full' : '',
      ].join(' ')}
    >
      {leaf.label}
    </Link>
  );
}

interface NavGroupProps {
  group: NavGroup;
  pathname: string;
}

function NavGroupDesktop({ group, pathname }: NavGroupProps) {
  return (
    <DetailsDropdown
      summary={
        <>
          <span>{group.label}</span>
          <Icon icon="chevronDown" size="sm" />
        </>
      }
    >
      <GroupItems items={group.items} pathname={pathname} />
    </DetailsDropdown>
  );
}

function NavGroupMobile({ group, pathname }: NavGroupProps) {
  return (
    <DetailsDropdown summary={<span>{group.label}</span>}>
      <GroupItems items={group.items} pathname={pathname} />
    </DetailsDropdown>
  );
}

interface GroupItemsProps {
  items: NavLeaf[];
  pathname: string;
}

function GroupItems({ items, pathname }: GroupItemsProps) {
  return (
    <ul className="flex flex-col gap-0.5 py-1">
      {items.map((item) => {
        const active = pathname === item.to;
        return (
          <li key={item.to}>
            <Link
              href={item.to}
              aria-current={active ? 'page' : undefined}
              className={[
                'inline-flex min-h-11 w-full items-center whitespace-nowrap rounded-control px-3 py-2 text-sm text-accent transition-colors',
                'hover:bg-overlay-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                active ? 'font-semibold' : '',
              ].join(' ')}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

interface DetailsDropdownProps {
  summary: ReactNode;
  children: ReactNode;
}

/**
 * Native <details>/<summary> dropdown. Keyboard-operable by default (Enter and
 * Space toggle, Tab moves through links), and its open state is exposed to
 * assistive tech without ARIA wiring. The one addition over native is Escape
 * to close and restore focus to the summary, which <details> does not do.
 * Styled with semantic tokens: md-radius control surface, raised-paper panel,
 * hairline border, teal focus ring.
 */
function DetailsDropdown({ summary, children }: DetailsDropdownProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  function onKeyDown(event: React.KeyboardEvent<HTMLDetailsElement>) {
    if (event.key !== 'Escape') return;
    if (detailsRef.current?.open) {
      event.preventDefault();
      detailsRef.current.open = false;
      summaryRef.current?.focus();
    }
  }

  // Open on mouse enter and close on mouse leave so the panel follows the
  // pointer. Native <details> only toggles on click.
  function onMouseEnter() {
    if (detailsRef.current !== null && !detailsRef.current.open) {
      detailsRef.current.open = true;
    }
  }

  function onMouseLeave() {
    if (detailsRef.current?.open) {
      detailsRef.current.open = false;
    }
  }

  return (
    <details
      ref={detailsRef}
      onKeyDown={onKeyDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="group relative rounded-control"
    >
      <summary
        ref={summaryRef}
        className={[
          'inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-control px-3 py-2 text-sm text-accent transition-colors',
          'hover:bg-overlay-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
        ].join(' ')}
      >
        {summary}
      </summary>
      <div className="absolute left-0 top-full z-30 w-max min-w-full rounded-control border border-border-subtle bg-raised/90 px-1 py-1 shadow-none backdrop-blur-sm motion-safe:transition-colors">
        {children}
      </div>
    </details>
  );
}

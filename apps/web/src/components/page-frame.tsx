import { useEffect, type ReactNode } from 'react';
import { useLocation } from '@tanstack/react-router';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { StatusMessage, useStatusMessage } from './status-message.tsx';

export interface PageFrameProps {
  children: ReactNode;
}

interface NavItem {
  label: string;
  to: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Account', to: '/account' },
  { label: 'Report', to: '/account/report' },
  { label: 'Focus', to: '/account/focus' },
  { label: 'Games', to: '/account/games' },
  { label: 'Import', to: '/account/import' },
  { label: 'Proof sheet', to: '/account/proof-sheet' },
  { label: 'Plans', to: '/account/upgrade' },
  { label: 'Settings', to: '/account/settings' },
];

export function PageFrame({ children }: PageFrameProps) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { flash, markPresented, clearMessage } = useStatusMessage();
  const atDestination = flash !== null && pathname === flash.destination;
  const showNav = pathname === '/account' || pathname.startsWith('/account/');

  useEffect(() => {
    if (flash === null) return;
    if (pathname === flash.destination) {
      if (!flash.presented) markPresented();
    } else if (flash.presented) {
      clearMessage();
    }
  }, [clearMessage, flash, markPresented, pathname]);

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
          </div>
          {showNav ? (
            <nav aria-label="Account" className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
              {NAV_ITEMS.map((item) => (
                <Link key={item.to} href={item.to}>
                  {item.label}
                </Link>
              ))}
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

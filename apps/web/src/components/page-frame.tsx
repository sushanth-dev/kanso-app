import { useEffect, type ReactNode } from 'react';
import { useLocation } from '@tanstack/react-router';
import { StatusMessage, useStatusMessage } from './status-message.tsx';

export interface PageFrameProps {
  children: ReactNode;
}

export function PageFrame({ children }: PageFrameProps) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { flash, markPresented, clearMessage } = useStatusMessage();
  const atDestination = flash !== null && pathname === flash.destination;

  useEffect(() => {
    if (flash === null) return;
    if (pathname === flash.destination) {
      if (!flash.presented) markPresented();
    } else if (flash.presented) {
      clearMessage();
    }
  }, [clearMessage, flash, markPresented, pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-page font-ui">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent focus:outline-none focus:ring-2 focus:ring-focus"
      >
        Skip to main content
      </a>
      <header className="border-b border-border-subtle">
        <div className="mx-auto w-full max-w-3xl px-4 py-4">
          <p className="font-display text-xl leading-tight">Kanso Chess</p>
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

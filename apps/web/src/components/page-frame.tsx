import type { ReactNode } from 'react';
import { Heading } from '@astryxdesign/core/Heading';

export interface PageFrameProps {
  children: ReactNode;
}

export function PageFrame({ children }: PageFrameProps) {
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
          <Heading level={2}>Kanso Chess</Heading>
        </div>
      </header>
      <main id="main-content" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  );
}

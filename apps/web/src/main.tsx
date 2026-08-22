import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, Link } from '@tanstack/react-router';
import { Theme } from '@astryxdesign/core/theme';
import { LinkProvider } from '@astryxdesign/core/Link';
import { queryClient } from './query-client.ts';
import { router } from './router.tsx';
import { studyRoomTheme } from './theme.ts';
import './styles.css';
import './study-room-theme.css';

const root = document.getElementById('root');
if (root === null) throw new Error('Missing #root mount point.');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Theme theme={studyRoomTheme} mode="light">
        {/* Astryx's Link/Button render TanStack's Link when given an `href`;
            TanStack reads it back off the `to` prop Astryx injects alongside it. */}
        <LinkProvider component={Link}>
          <RouterProvider router={router} context={{ queryClient }} />
        </LinkProvider>
      </Theme>
    </QueryClientProvider>
  </StrictMode>,
);

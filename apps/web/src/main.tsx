import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, Link } from '@tanstack/react-router';
import { Theme } from '@astryxdesign/core/theme';
import { LinkProvider } from '@astryxdesign/core/Link';
import { queryClient } from './query-client.ts';
import { router } from './router.tsx';
import { studyRoomTheme } from './theme.ts';
import { applyContrast, resolveInitialContrast } from './contrast.ts';
import { applyTheme, resolveInitialTheme } from './theme-preference.ts';
import './styles.css';
import './study-room-theme.css';
// The attributes must exist at first paint or a theme snaps in a frame late.
// (ST-104 contrast, ST-148 theme.) The Theme component's mode agrees with the
// resolved theme so its own sync writes the same value on mount.
applyContrast(resolveInitialContrast());
const initialTheme = resolveInitialTheme();
applyTheme(initialTheme);

const root = document.getElementById('root');
if (root === null) throw new Error('Missing #root mount point.');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Theme theme={studyRoomTheme} mode={initialTheme === 'nocturne' ? 'dark' : 'light'}>
        {/* Astryx's Link/Button render TanStack's Link when given an `href`;
            TanStack reads it back off the `to` prop Astryx injects alongside it. */}
        <LinkProvider component={Link}>
          <RouterProvider router={router} context={{ queryClient }} />
        </LinkProvider>
      </Theme>
    </QueryClientProvider>
  </StrictMode>,
);

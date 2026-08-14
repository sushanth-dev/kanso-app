import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { Theme } from '@astryxdesign/core/theme';
import { queryClient } from './query-client.ts';
import { router } from './router.tsx';
import { studyRoomTheme } from './theme.ts';
import './styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('Missing #root mount point.');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Theme theme={studyRoomTheme} mode="light">
        <RouterProvider router={router} context={{ queryClient }} />
      </Theme>
    </QueryClientProvider>
  </StrictMode>,
);

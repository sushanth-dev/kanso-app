import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Theme } from '@astryxdesign/core/theme';
import { Shell } from './shell.tsx';
import { studyRoomTheme } from './theme.ts';
import './styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('Missing #root mount point.');

createRoot(root).render(
  <StrictMode>
    <Theme theme={studyRoomTheme} mode="light">
      <Shell />
    </Theme>
  </StrictMode>,
);

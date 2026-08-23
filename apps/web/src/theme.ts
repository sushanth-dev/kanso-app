// `__built: true` skips Astryx's runtime style injection; the CSS is pre-built
// into `./study-room-theme.css`. Regenerate after editing this theme with:
//   npx tsx scripts/generate-theme-css.mjs

import { defineTheme, type DefinedTheme } from '@astryxdesign/core/theme';

export const studyRoomTheme: DefinedTheme = {
  ...defineTheme({
    name: 'study-room',
    tokens: {
      '--color-background-body': 'var(--kanso-color-surface-page)',
      '--color-background-surface': 'var(--kanso-color-surface-raised)',
      '--color-background-card': 'var(--kanso-color-surface-raised)',
      '--color-background-muted': 'var(--kanso-color-surface-sunken)',
      '--color-text-primary': 'var(--kanso-color-text-primary)',
      '--color-text-secondary': 'var(--kanso-color-text-muted)',
      '--color-accent': 'var(--kanso-color-action-primary-default)',
      '--color-on-accent': 'var(--kanso-color-text-on-accent)',
      '--color-border': 'var(--kanso-color-border-subtle)',
      '--color-border-emphasized': 'var(--kanso-color-border-strong)',
      '--font-family-body': 'var(--kanso-font-ui)',
      '--font-family-heading': 'var(--kanso-font-display)',
      // Link's default color and Button's secondary/destructive variants pull
      // these tokens too; left at Astryx defaults they render Astryx's blue
      // link and navy-tinted neutral instead of the app's palette.
      '--color-text-accent': 'var(--kanso-color-link)',
      '--color-neutral': 'color-mix(in srgb, var(--kanso-color-ink-900) 8%, transparent)',
      '--color-overlay-hover': 'color-mix(in srgb, var(--kanso-color-ink-900) 5%, transparent)',
      '--color-overlay-pressed': 'color-mix(in srgb, var(--kanso-color-ink-900) 10%, transparent)',
      '--color-error': 'var(--kanso-color-danger)',
      '--color-on-error': 'var(--kanso-color-text-on-accent)',
    },
    components: {
      button: {
        'variant:primary': {
          ':hover': {
            backgroundColor: 'var(--kanso-color-action-primary-hover)',
            backgroundImage: 'none',
          },
          ':active': {
            backgroundColor: 'var(--kanso-color-action-primary-hover)',
            backgroundImage: 'none',
          },
        },
      },
    },
  }),
  __built: true,
};

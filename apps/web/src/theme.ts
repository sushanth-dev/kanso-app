import { defineTheme } from '@astryxdesign/core/theme';

export const studyRoomTheme = defineTheme({
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
});

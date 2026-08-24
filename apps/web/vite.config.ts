import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';

// A navigation is the SPA; a fetch is the API read.
const htmlBypass: NonNullable<ProxyOptions['bypass']> = (req) => {
  if (req.headers.accept?.includes('text/html')) return '/index.html';
};
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/me': 'http://127.0.0.1:3000',
      // The SPA routes /report, /focus, and /games share their path with an
      // API endpoint now that the /account prefix is gone (ST-088): a browser
      // navigation (Accept: text/html) is the page; a fetch is the API read,
      // the same split /guardians and /shared use below.
      '/report': {
        target: 'http://127.0.0.1:3000',
        bypass: htmlBypass,
      },
      '/motifs': 'http://127.0.0.1:3000',
      '/phase': 'http://127.0.0.1:3000',
      '/mistakes': 'http://127.0.0.1:3000',
      '/focuses': 'http://127.0.0.1:3000',
      '/focus': {
        target: 'http://127.0.0.1:3000',
        bypass: htmlBypass,
      },
      '/payments': 'http://127.0.0.1:3000',
      '/guardians': {
        target: 'http://127.0.0.1:3000',
        // A browser navigation (Accept: text/html) is the page; a fetch is the
        // confirm read, the same split the /shared proxy uses.
        bypass(req) {
          if (req.headers.accept?.includes('text/html')) return '/index.html';
        },
      },
      '/players': 'http://127.0.0.1:3000',
      '/games': {
        target: 'http://127.0.0.1:3000',
        bypass: htmlBypass,
      },
      '/imports': 'http://127.0.0.1:3000',
      '/proof-sheets': 'http://127.0.0.1:3000',
      '/shared': {
        target: 'http://127.0.0.1:3000',
        // The shared page and its JSON snapshot share one path. A browser
        // navigation (Accept: text/html) is the page; a fetch is the API read.
        bypass(req) {
          if (req.headers.accept?.includes('text/html')) return '/index.html';
        },
      },
    },
  },
});

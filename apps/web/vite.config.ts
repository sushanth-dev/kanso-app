import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';
import Icons from 'unplugin-icons/vite';

// A navigation is the SPA; a fetch is the API read.
const htmlBypass: NonNullable<ProxyOptions['bypass']> = (req) => {
  if (req.headers.accept?.includes('text/html')) return '/index.html';
};
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Solar icons via Iconify, resolved from the offline @iconify-json/solar
    // icon set at build time (`~icons/solar/<name>`) into components matching
    // Astryx `Icon`'s component mode; no runtime call to Iconify's API (ST-133).
    Icons({ compiler: 'jsx', jsx: 'react' }),
  ],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/me': 'http://127.0.0.1:3000',
      // The SPA routes /report, /focus, /games, /tournaments, and /transfer-gap
      // share their path with an API endpoint now that the /account prefix is
      // gone (ST-088): a browser navigation (Accept: text/html) is the page; a
      // fetch is the API read, the same split /guardians and /shared use below.
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
      '/tournaments': {
        target: 'http://127.0.0.1:3000',
        bypass: htmlBypass,
      },
      '/transfer-gap': {
        target: 'http://127.0.0.1:3000',
        bypass: htmlBypass,
      },
      // ST-106: /practice is both a drill page and an API path. A browser
      // navigation (Accept: text/html) is the page; a fetch is the API read,
      // the same split /report and /games use above.
      '/practice': {
        target: 'http://127.0.0.1:3000',
        bypass: htmlBypass,
      },
      '/imports': 'http://127.0.0.1:3000',
      '/assignments': 'http://127.0.0.1:3000',
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

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/me': 'http://127.0.0.1:3000',
      '/focuses': 'http://127.0.0.1:3000',
      '/guardians': {
        target: 'http://127.0.0.1:3000',
        // A browser navigation (Accept: text/html) is the page; a fetch is the
        // confirm read, the same split the /shared proxy uses.
        bypass(req) {
          if (req.headers.accept?.includes('text/html')) return '/index.html';
        },
      },
      '/players': 'http://127.0.0.1:3000',
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

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
      '/players': 'http://127.0.0.1:3000',
    },
  },
});

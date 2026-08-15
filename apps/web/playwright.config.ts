import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  webServer: [
    {
      command: 'npm start --workspace apps/api',
      cwd: repositoryRoot,
      url: 'http://127.0.0.1:3000/health',
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        APP_ORIGIN: 'http://127.0.0.1:5173',
        BETTER_AUTH_URL: 'http://127.0.0.1:5173',
        SES_FROM_ADDRESS: 'sender@example.com',
        IMPORT_PROVIDER_STUB: '1',
      },
    },
    {
      command: 'npm run dev --workspace apps/web',
      cwd: repositoryRoot,
      url: 'http://127.0.0.1:5173/sign-in',
      reuseExistingServer: !process.env.CI,
    },
  ],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'phone-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
});

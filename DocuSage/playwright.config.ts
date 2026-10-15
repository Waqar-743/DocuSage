import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.WEB_BASE_URL || 'http://127.0.0.1:1420';

export default defineConfig({
  testDir: './tests/web',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL, trace: 'retain-on-failure' },
  // Serve the production build of the site so `npm run test:web` works
  // standalone and validates what actually ships. Set WEB_BASE_URL to test
  // an already-running server instead.
  webServer: process.env.WEB_BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 1420 --strictPort',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
});

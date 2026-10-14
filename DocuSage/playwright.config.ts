import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/web',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: process.env.WEB_BASE_URL || 'http://127.0.0.1:1420', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
});

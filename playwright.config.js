// @ts-check
import { defineConfig, devices } from '@playwright/test';

// Every run writes a new JSON report into storage/reports/, which the dashboard picks up.
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  reporter: [
    ['list'],
    ['json', { outputFile: `storage/reports/run-${stamp}.json` }],
    ['./scripts/manifest-reporter.mjs'],
  ],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node scripts/serve.mjs',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});

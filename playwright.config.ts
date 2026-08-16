import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const PORT = 5199;

/**
 * Use a pre-installed Chromium when one is present (this build environment ships
 * one at /opt/pw-browsers/chromium, which will not match the revision Playwright
 * would download). Falls back to Playwright-managed browsers everywhere else, so
 * the suite still runs on a normal dev machine after `npx playwright install`.
 */
const preinstalledChromium = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const launchOptions = existsSync(preinstalledChromium)
  ? { executablePath: preinstalledChromium }
  : {};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'line' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

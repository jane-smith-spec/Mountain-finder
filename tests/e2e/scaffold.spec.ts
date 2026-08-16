import { test, expect } from '@playwright/test';

/**
 * Toolchain canary for the browser layer: proves Playwright can start the dev
 * server, drive real Chromium, and see rendered React output. Phase 5 adds the
 * real end-to-end pipeline tests alongside this.
 */
test('app shell renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('app-title')).toHaveText('Mountain Finder');
  await expect(page.getByTestId('app-phase')).toBeVisible();
});

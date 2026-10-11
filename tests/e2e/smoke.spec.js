import { test, expect } from '@playwright/test';
import { authenticateAs } from './fixtures/auth.fixture.js';
import { ROUTES } from './fixtures/test-data.js';
import { waitForViewReady } from './fixtures/simulation.fixture.js';

test.describe('OmniTRAF Smoke Tests - All 12 Views', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, 'OPERATOR');
  });

  for (const route of ROUTES) {
    test(`loads view ${route.label} (${route.path}) without fatal console errors`, async ({ page }) => {
      const pageErrors = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      await page.goto(`/${route.path}`);
      await waitForViewReady(page, route.id);

      const viewEl = page.locator(`#${route.id}`);
      await expect(viewEl).toBeVisible();

      // Ensure no uncaught fatal JavaScript errors occurred during load
      expect(pageErrors).toEqual([]);
    });
  }
});

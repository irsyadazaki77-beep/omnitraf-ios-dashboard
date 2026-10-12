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
      const consoleErrors = [];
      const failedRequests = [];
      const badResponses = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`));
      page.on('response', (response) => {
        if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
      });

      await page.goto(`/${route.path}`);
      try {
        await waitForViewReady(page, route.id);
      } catch (error) {
        throw new Error(`${error.message}\nPage errors: ${JSON.stringify(pageErrors)}\nConsole errors: ${JSON.stringify(consoleErrors)}\nFailed requests: ${JSON.stringify(failedRequests)}\nBad responses: ${JSON.stringify(badResponses)}`);
      }

      const viewEl = page.locator(`#${route.id}`);
      await expect(viewEl).toBeVisible();

      // Ensure no uncaught fatal JavaScript errors occurred during load
      expect({ pageErrors, consoleErrors }).toEqual({ pageErrors: [], consoleErrors: [] });
    });
  }
});

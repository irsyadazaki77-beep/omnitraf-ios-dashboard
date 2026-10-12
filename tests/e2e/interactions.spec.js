import { test, expect } from '@playwright/test';
import { authenticateAs } from './fixtures/auth.fixture.js';
import { waitForViewReady } from './fixtures/simulation.fixture.js';

test.describe('Phase 5 key interaction checks', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, 'OPERATOR');
    await page.goto('/#dashboard');
    await waitForViewReady(page, 'view-dashboard');
  });

  test('map search and density filters remain available in their disclosure', async ({ page }) => {
    const searchDetails = page.locator('.dashboard-map-search');
    await searchDetails.locator('summary').click();

    const search = page.locator('#intersectionSearch');
    await expect(search).toBeVisible();
    await search.fill('Wonokromo');
    await expect(page.locator('#searchSuggestions .suggestion-item:not(.empty)').first()).toBeVisible();

    await page.locator('#view-dashboard .filter-chip[data-filter="high"]').click();
    await expect(page.locator('#dashboardMapBox')).toHaveAttribute('data-density', 'high');
  });

  test('command palette opens, navigates, and restores focus on Escape', async ({ page }) => {
    const trigger = page.locator('#headerSearchButton');
    await trigger.click();
    const palette = page.locator('#navigationPalette');
    await expect(palette).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('headerSearchButton');

    await trigger.click();
    await expect(palette).toBeVisible();

    const search = page.locator('#navigationPaletteSearch');
    await search.fill('Laporan');
    const reportResult = palette.locator('a[data-view="reports"]');
    await expect(reportResult).toBeVisible();
    await reportResult.click();
    await waitForViewReady(page, 'view-reports');
    await expect(palette).toBeHidden();
  });

  test('command palette supports keyboard entity search and selection', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const palette = page.locator('#navigationPalette');
    const search = page.locator('#navigationPaletteSearch');
    await expect(palette).toBeVisible();
    await search.fill('node-wonokromo');
    const result = palette.locator('[data-entity-kind="intersection"][data-entity-id="node-wonokromo"]');
    await expect(result).toBeVisible();
    await search.press('ArrowDown');
    await expect(result).toHaveAttribute('aria-selected', 'true');
    await search.press('Enter');
    await waitForViewReady(page, 'view-signals');
    await expect.poll(() => page.evaluate(() => document.activeElement?.dataset?.intersectionId)).toBe('node-wonokromo');
  });

  test('mobile topbar keeps the session exit reachable in its overflow menu', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = page.locator('.topbar-overflow');
    await overflow.locator('summary').click();
    const mobileLogout = page.locator('#btnMobileLogout');
    await expect(mobileLogout).toBeVisible();
    await expect(page.locator('#sessionLogout')).toBeHidden();
    await mobileLogout.click();
    await expect(page.locator('#operatorProfile')).toHaveAttribute('aria-label', 'Masuk ke simulator');
  });
});

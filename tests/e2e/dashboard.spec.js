import { test, expect } from '@playwright/test';
import { authenticateAs } from './fixtures/auth.fixture.js';
import { DashboardPage } from './pages/dashboard.page.js';
import { waitForViewReady } from './fixtures/simulation.fixture.js';

test.describe('Dashboard layout and controls', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, 'OPERATOR');
    await page.goto('/#dashboard');
    await waitForViewReady(page, 'view-dashboard');
  });

  test('keeps the four KPI strip, map grid, and hidden routes on their layout contract', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await expect(dashboard.kpiCards).toHaveCount(4);
    await expect(dashboard.status).not.toHaveText('Memuat status');
    await expect(dashboard.map).toBeVisible();
    await expect(dashboard.priorityPanel).toBeVisible();
    const geometry = await page.evaluate(() => ({
      dashboardDisplay: getComputedStyle(document.querySelector('#view-dashboard')).display,
      inlineDisplay: document.querySelector('#view-dashboard').style.display,
      mapWidth: document.querySelector('.dashboard-map-panel').getBoundingClientRect().width,
      priorityWidth: document.querySelector('.priority-panel').getBoundingClientRect().width,
      activePanes: [...document.querySelectorAll('.view-pane.active')].map((pane) => pane.id),
      visibleInactivePanes: [...document.querySelectorAll('.view-pane:not(.active)')]
        .filter((pane) => getComputedStyle(pane).display !== 'none' || !pane.hidden).map((pane) => pane.id)
    }));
    expect(geometry.dashboardDisplay).toBe('grid');
    expect(geometry.inlineDisplay).toBe('');
    expect(geometry.mapWidth).toBeGreaterThan(geometry.priorityWidth);
    expect(geometry.activePanes).toEqual(['view-dashboard']);
    expect(geometry.visibleInactivePanes).toEqual([]);
  });

  test('search, density filter, advanced controls, and refresh stay usable', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.searchIntersection('Wonokromo');
    await expect(page.locator('#searchSuggestions .suggestion-item:not(.empty)').first()).toBeVisible();
    await page.locator('#view-dashboard .filter-chip[data-filter="high"]').click();
    await expect(dashboard.map).toHaveAttribute('data-density', 'high');

    await dashboard.openAdvancedControls();
    await expect(dashboard.advancedControls).toHaveAttribute('open', '');
    const controlLayout = await page.locator('.dashboard-details-content').evaluate((element) => getComputedStyle(element).display);
    expect(controlLayout).toBe('grid');

    await dashboard.refresh();
    await expect(dashboard.refreshButton).toBeEnabled({ timeout: 15000 });
    await expect(dashboard.refreshButton).not.toHaveAttribute('aria-busy', 'true');
    const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewportWidth + 1);
  });

  test('Map stylesheet does not hide or restyle the Dashboard layer disclosure', async ({ page }) => {
    await page.goto('/#map');
    await waitForViewReady(page, 'view-map');
    await page.goto('/#dashboard');
    await waitForViewReady(page, 'view-dashboard');

    const layerDetails = page.locator('#view-dashboard .map-layer-deck');
    await layerDetails.locator('summary').click();
    await expect(layerDetails).toHaveAttribute('open', '');
    await expect(layerDetails.locator('.layer-item').first()).toBeVisible();
    await expect(page.locator('#dashboardMapBox')).toBeVisible();
  });
});

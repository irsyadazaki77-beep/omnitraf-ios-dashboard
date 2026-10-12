import { test, expect } from '@playwright/test';
import { authenticateAs } from './fixtures/auth.fixture.js';
import { waitForViewReady } from './fixtures/simulation.fixture.js';

test.describe('Intelligence and reporting workspaces', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, 'OPERATOR');
  });

  test('analytics chart and period control update the report context', async ({ page }) => {
    await page.goto('/#analytics');
    await waitForViewReady(page, 'view-analytics');
    const corridor = page.locator('#analyticsCorridorSelect');
    await expect(corridor).toBeVisible();
    const previousValue = await corridor.inputValue();
    const option = await corridor.locator('option').nth(1).getAttribute('value');
    await corridor.selectOption(option);
    await expect(corridor).toHaveValue(option);
    await expect(page.locator('#trendChart')).toBeVisible();
    expect(await page.locator('#view-analytics').evaluate((view) => view.scrollWidth <= view.clientWidth + 1)).toBe(true);
    expect(previousValue).not.toBe(option);
  });

  test('Reports CSV export produces a downloadable session artifact', async ({ page }) => {
    await page.goto('/#reports');
    await waitForViewReady(page, 'view-reports');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#btnExportCsv').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/i);
    await expect(page.locator('#exportHistoryList')).not.toContainText('Belum ada berkas');
  });
});

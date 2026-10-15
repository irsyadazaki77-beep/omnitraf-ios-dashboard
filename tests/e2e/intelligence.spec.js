import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
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
    const viewportWidths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth
    }));
    expect(viewportWidths.scroll <= viewportWidths.client + 1, JSON.stringify(viewportWidths)).toBe(true);
    const corridorTableScroller = page.locator('#analyticsCorridorBreakdownCard .analytics-corridor-table-scroll');
    await expect(corridorTableScroller).toBeVisible();
    const tableScrollContract = await corridorTableScroller.evaluate((scroller) => ({
      overflowX: getComputedStyle(scroller).overflowX,
      width: Math.round(scroller.getBoundingClientRect().width),
      parentWidth: Math.round(scroller.parentElement.getBoundingClientRect().width)
    }));
    expect(tableScrollContract.overflowX).toBe('auto');
    expect(tableScrollContract.width).toBeLessThanOrEqual(tableScrollContract.parentWidth + 1);
    expect(previousValue).not.toBe(option);
  });

  test('Reports CSV export produces a downloadable session artifact', async ({ page }) => {
    await page.goto('/#reports');
    await waitForViewReady(page, 'view-reports');
    await expect(page.locator('#btnExportCsv')).toBeDisabled();
    await page.locator('#btnCreateReportSnapshot').click();
    await expect(page.locator('#reportDocPreviewState')).toBeVisible();
    const snapshotId = (await page.locator('#repPreviewDocId').innerText()).match(/SIM-[0-9]+/)?.[0];
    expect(snapshotId).toBeTruthy();
    await expect(page.locator('#activeReportSnapshotState')).toContainText(snapshotId);
    await expect(page.locator('#btnExportCsv')).toBeEnabled();
    await page.locator('#btnClosePreviewDoc').click();
    await expect(page.locator('#reportModal')).toHaveAttribute('aria-hidden', 'true');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#btnExportCsv').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/i);
    const csv = await readFile(await download.path(), 'utf8');
    expect(csv).toContain(snapshotId);
    await expect(page.locator(`#exportHistoryList [data-snapshot-id="${snapshotId}"]`)).toBeVisible();
  });

  test('PDF, JSON, and print reuse one explicit snapshot ID', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Desktop-Dark', 'Cross-format export lifecycle runs once in desktop Chromium.');
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (value) => { window.__omnitrafCopiedJson = value; } }
      });
      window.print = () => {
        window.__omnitrafPrintedSnapshot = document.getElementById('executivePrintDoc')?.dataset?.snapshotId || null;
      };
    });
    await page.goto('/#reports');
    await waitForViewReady(page, 'view-reports');
    await page.locator('#btnCreateReportSnapshot').click();
    await expect(page.locator('#reportDocPreviewState')).toBeVisible();
    const snapshotId = (await page.locator('#repPreviewDocId').innerText()).match(/SIM-[0-9]+/)?.[0];
    expect(snapshotId).toBeTruthy();
    await expect(page.locator('#docPreviewSnapshotId')).toHaveText(snapshotId);

    const pdfPromise = page.waitForEvent('download');
    await page.locator('#btnPrintReportDoc').click();
    expect((await pdfPromise).suggestedFilename()).toMatch(/\.pdf$/i);
    await expect(page.locator(`#exportHistoryList [data-snapshot-id="${snapshotId}"]`)).toBeVisible();
    await page.locator('#btnClosePreviewDoc').click();
    await expect(page.locator('#reportModal')).toHaveAttribute('aria-hidden', 'true');

    await page.locator('#btnCopyTelemetryJson').click();
    const copiedSnapshotId = await page.evaluate(() => JSON.parse(window.__omnitrafCopiedJson || '{}').id);
    expect(copiedSnapshotId).toBe(snapshotId);

    await page.locator('#btnPrintExecutive').click();
    expect(await page.evaluate(() => window.__omnitrafPrintedSnapshot)).toBe(snapshotId);
    await expect(page.locator('#printSnapshotId')).toHaveText(snapshotId);
  });
});

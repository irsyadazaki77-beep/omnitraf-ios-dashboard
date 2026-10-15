import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { authenticateAs } from './fixtures/auth.fixture.js';
import { waitForViewReady } from './fixtures/simulation.fixture.js';

test.describe('Scenario Lab isolated simulation workflow', () => {
  test('builds, replays, compares, exports, and captures a deterministic lab run', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Desktop-Dark', 'Scenario Lab workflow is exercised once in a deterministic Chromium project.');
    await authenticateAs(page, 'OPERATOR');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/#prediction');
    await waitForViewReady(page, 'view-prediction');
    await expect(page.getByRole('heading', { name: 'Scenario Lab' })).toBeVisible();
    await page.locator('#scenarioHorizon').selectOption('15');
    await page.locator('#scenarioPreset').selectOption('major-incident');
    
    // Exercise playback speed selection (1×, 2×, 4×)
    await page.locator('.scenario-speed-btn[data-speed="2"]').click();
    await expect(page.locator('.scenario-speed-btn[data-speed="2"]')).toHaveClass(/is-active/);
    await page.locator('.scenario-speed-btn[data-speed="1"]').click();
    await expect(page.locator('.scenario-speed-btn[data-speed="1"]')).toHaveClass(/is-active/);

    await page.locator('#scenarioRunButton').click();
    await expect(page.locator('#scenarioTimelineLabel')).toContainText('running');
    await expect(page.locator('#scenarioTimelineLabel')).toContainText('completed', { timeout: 20_000 });
    await expect(page.locator('#scenarioEventList')).toContainText('Insiden critical');
    await expect(page.locator('#scenarioMetricGrid')).toContainText('km/jam');
    await page.locator('.scenario-corridor-details summary').click();
    await expect(page.locator('#scenarioCorridorRows tr').first()).toBeVisible();

    const captureDir = process.env.PHASE26_CAPTURE_DIR || process.env.PHASE18_CAPTURE_DIR;
    if (captureDir) {
      await mkdir(captureDir, { recursive: true });
      await page.screenshot({ path: path.join(captureDir, 'scenario-lab-desktop.png'), fullPage: true, animations: 'disabled' });
    }

    await page.locator('#scenarioCompareAlt').selectOption('road-closure');
    await page.locator('#scenarioCompareButton').click();
    await expect(page.locator('#scenarioComparisonResult')).toBeVisible();
    await expect(page.locator('#scenarioComparisonResult')).toContainText('SAME INITIAL STATE');
    await expect(page.locator('#scenarioComparisonResult')).toContainText('Road Closure');
    if (captureDir) await page.screenshot({ path: path.join(captureDir, 'scenario-lab-comparison-desktop.png'), fullPage: true, animations: 'disabled' });

    for (const [view, paneId] of [['map', 'view-map'], ['city3d', 'view-city3d'], ['cctv', 'view-cctv'], ['signals', 'view-signals'], ['analytics', 'view-analytics'], ['reports', 'view-reports']]) {
      await page.locator(`.scenario-workspace-links a[data-view="${view}"]`).click();
      await waitForViewReady(page, paneId);
      await expect(page.locator('#scenarioLabPreview')).toBeVisible();
      await expect(page.locator('#scenarioLabPreview')).toContainText('m antrean');
      await page.locator('#scenarioPreviewReturn').click();
      await waitForViewReady(page, 'view-prediction');
    }

    const jsonDownload = page.waitForEvent('download');
    await page.locator('#scenarioExportJson').click();
    expect((await jsonDownload).suggestedFilename()).toMatch(/omnitraf-scenario-.*\.json/);
    const csvDownload = page.waitForEvent('download');
    await page.locator('#scenarioExportCsv').click();
    expect((await csvDownload).suggestedFilename()).toMatch(/omnitraf-scenario-.*\.csv/);

    await page.locator('#scenarioReplayButton').click();
    await expect(page.locator('#scenarioTimelineLabel')).toContainText('running');
    await page.locator('#scenarioPauseButton').click();
    await expect(page.locator('#scenarioTimelineLabel')).toContainText('paused');
    await page.locator('#scenarioResetButton').click();
    await expect(page.locator('#scenarioTimelineLabel')).toContainText('idle');
    await expect(page.locator('#scenarioLabPreview')).toBeHidden();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: captureDir ? path.join(captureDir, 'scenario-lab-mobile.png') : testInfo.outputPath('scenario-lab-mobile.png'), fullPage: true, animations: 'disabled' });
    const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.viewport + 1);
  });

  test('scenario lab run controls remain role protected and viewer can only read presets', async ({ page }) => {
    await authenticateAs(page, 'VIEWER');
    const presets = await page.request.get('/api/scenario-lab/presets');
    expect(presets.status()).toBe(200);
    const create = await page.request.post('/api/scenario-lab/sessions', { data: { seed: 22, hour: 8, horizonMinutes: 15 } });
    expect(create.status()).toBe(403);
    const compare = await page.request.post('/api/scenario-lab/compare', { data: { baseline: 'normal', alternative: 'heavy-rain', seed: 22, hour: 8, horizonMinutes: 15 } });
    expect(compare.status()).toBe(200);
    expect((await compare.json()).data.sameInitialState).toBe(true);
  });
});

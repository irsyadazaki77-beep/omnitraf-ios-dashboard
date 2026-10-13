import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { authenticateAs } from './fixtures/auth.fixture.js';
import { waitForViewReady, stabilizeVisualState } from './fixtures/simulation.fixture.js';

test('CCTV scenes switch, remain visible without detections, pause, snapshot and render per camera', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'Desktop-Dark', 'CCTV visual proof is captured once in the desktop Chromium project.');
  await authenticateAs(page, 'OPERATOR');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#cctv');
  await waitForViewReady(page, 'view-cctv');
  await stabilizeVisualState(page);

  const output = process.env.PHASE12_CCTV_CAPTURE_DIR
    ? path.resolve(process.env.PHASE12_CCTV_CAPTURE_DIR)
    : path.join(process.cwd(), 'artifacts', 'phase12-cctv');
  await mkdir(output, { recursive: true });
  const tabs = page.locator('.cctv-cam-tab');
  const ids = ['cctvCanvas1', 'cctvCanvas2', 'cctvCanvas3', 'cctvCanvas4'];
  const frameRates = [];
  for (let i = 0; i < ids.length; i++) {
    await tabs.nth(i).click();
    await expect(page.locator(`[data-cam-id="${ids[i]}"]`)).toBeVisible();
    await page.waitForTimeout(1100);
    const canvas = page.locator(`#${ids[i]}`);
    const rendered = await canvas.evaluate((node) => {
      const ctx = node.getContext('2d');
      const data = ctx.getImageData(0, 0, node.width, node.height).data;
      const samples = [];
      for (let p = 0; p < data.length; p += Math.max(4, Math.floor(data.length / 1000 / 4) * 4)) samples.push(`${data[p]},${data[p + 1]},${data[p + 2]}`);
      return { width: node.width, height: node.height, colors: new Set(samples).size, fps: Number(node.dataset.renderFps || 0) };
    });
    expect(rendered.width).toBeGreaterThan(0);
    expect(rendered.colors).toBeGreaterThan(8);
    expect(rendered.fps).toBeGreaterThan(0);
    frameRates.push({ camera: ids[i], fps: rendered.fps, backingWidth: rendered.width, backingHeight: rendered.height });
    await page.locator(`[data-cam-id="${ids[i]}"]`).screenshot({ path: path.join(output, `camera-0${i + 1}.png`) });
  }

  await page.locator('.cctv-view-options > summary').click();
  await page.locator('.matrix-btn[data-grid="grid-2x2"]').click();
  await page.waitForTimeout(1800);
  const gridFrameRates = await page.locator('.cctv-canvas').evaluateAll((nodes) => nodes.map((node) => ({
    camera: node.id, fps: Number(node.dataset.renderFps || 0), backingWidth: node.width, backingHeight: node.height
  })));
  await writeFile(path.join(output, 'fps-measurements.json'), JSON.stringify({ singleView: frameRates, grid2x2: gridFrameRates }, null, 2));
  await page.locator('.matrix-btn[data-grid="grid-focus"]').click();

  const overlayButton = page.locator('#btnToggleCVBoxes');
  await overlayButton.click();
  await expect(overlayButton).toContainText('Tampilkan Overlay');
  const visibleWithoutOverlay = await page.locator('#cctvCanvas4').evaluate((node) => {
    const pixels = node.getContext('2d').getImageData(0, 0, node.width, node.height).data;
    return pixels.some((value, index) => index % 4 !== 3 && value > 90);
  });
  expect(visibleWithoutOverlay).toBe(true);

  await page.locator('#cctvTimeOfDay').selectOption('night');
  await page.locator('#cctvWeather').selectOption('heavy-rain');
  await page.locator('.cctv-view-options > summary').click();
  await page.locator('#toastStack .toast-item').evaluateAll((items) => items.forEach((item) => item.remove()));
  await page.waitForTimeout(250);
  await page.locator('[data-cam-id="cctvCanvas4"]').screenshot({ path: path.join(output, 'camera-04-night-rain.png') });
  const pause = page.locator('#btnPlayPauseCctv');
  await pause.click();
  await expect(pause).toContainText('Putar');
  await pause.click();
  await expect(pause).toContainText('Jeda');

  const download = page.waitForEvent('download');
  await page.locator('#btnCaptureSnapshot').click();
  expect((await download).suggestedFilename()).toContain('Simulasi-cctvCanvas4');

  await page.locator('#btnCctvZoom').click();
  await expect(page.locator('#cctvZoomModal')).toHaveClass(/show/);
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id || '')).toBe('cctvZoomModal');
  await page.locator('#closeCctvZoomModal').click();
  await expect(page.locator('#cctvZoomModal')).not.toHaveClass(/show/);
});

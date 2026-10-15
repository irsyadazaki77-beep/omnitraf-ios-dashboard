import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { authenticateAs } from './fixtures/auth.fixture.js';
import { waitForViewReady, stabilizeVisualState } from './fixtures/simulation.fixture.js';

test('CCTV scenes switch, remain visible without detections, pause, snapshot and render per camera', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  test.skip(testInfo.project.name !== 'Desktop-Dark', 'CCTV visual proof is captured once in the desktop Chromium project.');
  await authenticateAs(page, 'OPERATOR');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#cctv');
  await waitForViewReady(page, 'view-cctv');
  await stabilizeVisualState(page);
  await page.locator('.cctv-view-options').evaluate((details) => { details.open = true; });
  await page.locator('#cctvTimeOfDay').selectOption('day');
  await page.locator('#cctvWeather').selectOption('clear');
  await expect.poll(() => page.evaluate(() => window.stateStore.getState().visualEnvironment)).toEqual({ timeOfDay: 'day', weather: 'clear' });
  await page.locator('.cctv-view-options').evaluate((details) => { details.open = false; });

  const output = process.env.PHASE12_CCTV_CAPTURE_DIR
    ? path.resolve(process.env.PHASE12_CCTV_CAPTURE_DIR)
    : path.join(process.cwd(), 'artifacts', 'phase23', 'e2e-cctv-capture');
  await mkdir(output, { recursive: true });
  const captureFeed = async (id, filename) => {
    const dataUrl = await page.locator(`#${id}`).evaluate((canvas) => canvas.toDataURL('image/png'));
    await writeFile(path.join(output, filename), Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
  };
  const tabs = page.locator('.cctv-cam-tab');
  const ids = ['cctvCanvas1', 'cctvCanvas2', 'cctvCanvas3', 'cctvCanvas4'];
  const frameRates = [];
  for (let i = 0; i < ids.length; i++) {
    await tabs.nth(i).evaluate((tab) => tab.click());
    await expect(page.locator(`[data-cam-id="${ids[i]}"]`)).toBeVisible();
    await page.waitForTimeout(1100);
    const canvas = page.locator(`#${ids[i]}`);
    await expect.poll(() => canvas.evaluate((node) => Number(node.dataset.sceneVehicles || 0))).toBeGreaterThan(0);
    const rendered = await canvas.evaluate((node) => {
      const ctx = node.getContext('2d');
      const data = ctx.getImageData(0, 0, node.width, node.height).data;
      const samples = [];
      for (let p = 0; p < data.length; p += Math.max(4, Math.floor(data.length / 1000 / 4) * 4)) samples.push(`${data[p]},${data[p + 1]},${data[p + 2]}`);
      return {
        width: node.width, height: node.height, colors: new Set(samples).size,
        fps: Number(node.dataset.renderFps || 0), sceneVehicles: Number(node.dataset.sceneVehicles || 0),
        frameMs: Number(node.dataset.renderFrameMs || 0), p95FrameMs: Number(node.dataset.renderP95Ms || 0),
        heapUsedBytes: performance.memory?.usedJSHeapSize ?? null
      };
    });
    expect(rendered.width).toBeGreaterThan(0);
    expect(rendered.colors).toBeGreaterThan(8);
    expect(rendered.fps).toBeGreaterThan(0);
    expect(rendered.sceneVehicles).toBeGreaterThan(0);
    expect(rendered.frameMs).toBeGreaterThan(0);
    frameRates.push({ camera: ids[i], ...rendered });
    await page.locator('#toastStack .toast-item').evaluateAll((items) => items.forEach((item) => item.remove()));
    await captureFeed(ids[i], `camera-0${i + 1}.png`);
  }

  await page.locator('.cctv-view-options').evaluate((details) => { details.open = true; });
  await page.locator('.matrix-btn[data-grid="grid-2x2"]').evaluate((button) => button.click());
  await page.waitForTimeout(1800);
  const gridFrameRates = await page.locator('.cctv-canvas').evaluateAll((nodes) => nodes.map((node) => ({
    camera: node.id, fps: Number(node.dataset.renderFps || 0), frameMs: Number(node.dataset.renderFrameMs || 0),
    p95FrameMs: Number(node.dataset.renderP95Ms || 0), sceneVehicles: Number(node.dataset.sceneVehicles || 0),
    backingWidth: node.width, backingHeight: node.height, heapUsedBytes: performance.memory?.usedJSHeapSize ?? null
  })));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage');
  await cdp.detach();
  await writeFile(path.join(output, 'fps-measurements.json'), JSON.stringify({ singleView: frameRates, grid2x2: gridFrameRates, heapAfterForcedGc: { usedBytes: heap.usedSize, totalBytes: heap.totalSize } }, null, 2));
  await page.locator('.matrix-btn[data-grid="grid-focus"]').evaluate((button) => button.click());
  await page.locator('.cctv-view-options').evaluate((details) => { details.open = true; });

  const overlayButton = page.locator('#btnToggleCVBoxes');
  await overlayButton.evaluate((button) => button.click());
  await expect(overlayButton).toContainText('Tampilkan Overlay');
  const visibleWithoutOverlay = await page.locator('#cctvCanvas4').evaluate((node) => {
    const pixels = node.getContext('2d').getImageData(0, 0, node.width, node.height).data;
    return pixels.some((value, index) => index % 4 !== 3 && value > 90);
  });
  expect(visibleWithoutOverlay).toBe(true);

  await page.locator('#cctvTimeOfDay').evaluate((select) => { select.value = 'night'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('#cctvWeather').evaluate((select) => { select.value = 'heavy-rain'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect.poll(() => page.evaluate(() => window.stateStore.getState().visualEnvironment)).toEqual({ timeOfDay: 'night', weather: 'heavy-rain' });
  await page.locator('#toastStack .toast-item').evaluateAll((items) => items.forEach((item) => item.remove()));
  await page.waitForTimeout(250);
  await captureFeed('cctvCanvas4', 'camera-04-night-rain.png');
  await page.locator('#cctvTimeOfDay').evaluate((select) => { select.value = 'evening'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('#cctvWeather').evaluate((select) => { select.value = 'light-rain'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(250);
  await page.locator('#toastStack .toast-item').evaluateAll((items) => items.forEach((item) => item.remove()));
  await captureFeed('cctvCanvas4', 'camera-04-evening-light-rain.png');
  await page.locator('#cctvTimeOfDay').evaluate((select) => { select.value = 'night'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('#cctvWeather').evaluate((select) => { select.value = 'heavy-rain'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('.cctv-view-options').evaluate((details) => { details.open = false; });
  await page.waitForTimeout(250);
  await page.locator('#toastStack .toast-item').evaluateAll((items) => items.forEach((item) => item.remove()));
  await page.screenshot({ path: path.join(process.cwd(), 'artifacts', 'phase23', 'after', 'cctv.png'), fullPage: false });
  const pause = page.locator('#btnPlayPauseCctv');
  await pause.click({ force: true });
  await expect(pause).toContainText('Putar');
  await pause.click({ force: true });
  await expect(pause).toContainText('Jeda');

  const download = page.waitForEvent('download');
  await page.locator('#btnCaptureSnapshot').click({ force: true });
  expect((await download).suggestedFilename()).toContain('Simulasi-cctvCanvas4');

  await page.locator('#btnCctvZoom').evaluate((button) => button.click());
  await expect(page.locator('#cctvZoomModal')).toHaveClass(/show/);
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id || '')).toBe('cctvZoomModal');
  await page.locator('#closeCctvZoomModal').evaluate((button) => button.click());
  await expect(page.locator('#cctvZoomModal')).not.toHaveClass(/show/);
});

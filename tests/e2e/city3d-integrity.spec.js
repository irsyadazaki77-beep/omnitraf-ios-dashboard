import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { authenticateAs } from './fixtures/auth.fixture.js';
import { waitForViewReady } from './fixtures/simulation.fixture.js';

test('City3D renders without WebGL errors and recovers after context restoration', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'Desktop-Dark', 'One browser proof capture per run.');
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
  await authenticateAs(page, 'OPERATOR');
  await page.goto('/#city3d');
  await waitForViewReady(page, 'view-city3d');
  const canvas = page.locator('#city3dCanvasHost canvas');
  await expect(canvas).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#city3dFps')).toHaveText(/\d+ FPS/, { timeout: 15000 });
  await page.waitForTimeout(1200);

  const beforeContextLoss = await page.evaluate(() => {
    const canvasElement = document.querySelector('#city3dCanvasHost canvas');
    const gl = canvasElement?.getContext('webgl2');
    return {
      webgl2: Boolean(gl), error: gl?.getError(), renderer: document.querySelector('#city3dPerf')?.textContent,
      fps: document.querySelector('#city3dFps')?.textContent, heapBytes: performance.memory?.usedJSHeapSize ?? null,
      canvas: { width: canvasElement?.width, height: canvasElement?.height }, hardwareConcurrency: navigator.hardwareConcurrency,
      userAgent: navigator.userAgent
    };
  });
  expect(beforeContextLoss.webgl2).toBeTruthy();
  expect(beforeContextLoss.error).toBe(0);
  mkdirSync('artifacts/fase25/after', { recursive: true });
  await page.locator('#city3dStage').screenshot({ path: 'artifacts/fase25/after/city3d.png' });
  writeFileSync('artifacts/fase25/benchmark-browser.json', JSON.stringify(beforeContextLoss, null, 2));

  const contextLost = page.evaluate(() => new Promise((resolve) => {
    const canvasElement = document.querySelector('#city3dCanvasHost canvas');
    canvasElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); resolve(true); }, { once: true });
    const gl = canvasElement.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) resolve(false);
    else { window.__city3dLoseContext = extension; extension.loseContext(); }
  }));
  expect(await contextLost).toBeTruthy();
  await expect(page.locator('#city3dFallback')).toBeVisible();
  await page.evaluate(() => window.__city3dLoseContext?.restoreContext());
  await expect(page.locator('#city3dFallback')).toBeHidden({ timeout: 15000 });
  await expect.poll(() => page.locator('#city3dFps').textContent()).toMatch(/\d+ FPS/);
  // Warm both lazy routes before taking the lifecycle heap baseline.
  await page.goto('/#map');
  await waitForViewReady(page, 'view-map');
  await expect(page.locator('#map-surabaya')).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'artifacts/fase25/after/map-cameras.png', animations: 'disabled', timeout: 20000 });
  await page.goto('/#city3d');
  await waitForViewReady(page, 'view-city3d');
  const heapSession = await page.context().newCDPSession(page);
  await heapSession.send('HeapProfiler.collectGarbage');
  const heapBeforeLifecycle = await heapSession.send('Runtime.getHeapUsage');
  await heapSession.detach();
  const lifecycleSamples = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.goto('/#map');
    await waitForViewReady(page, 'view-map');
    await page.goto('/#city3d');
    await waitForViewReady(page, 'view-city3d');
    await expect(page.locator('#city3dCanvasHost canvas')).toBeVisible();
    lifecycleSamples.push(await page.locator('#city3dPerf').textContent());
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const heapAfterLifecycle = await cdp.send('Runtime.getHeapUsage');
  await cdp.detach();
  writeFileSync('artifacts/fase25/benchmark-lifecycle.json', JSON.stringify({
    cycles: lifecycleSamples.length, rendererSamples: lifecycleSamples,
    heapBeforeForcedGcBytes: heapBeforeLifecycle.usedSize, heapAfterForcedGcBytes: heapAfterLifecycle.usedSize,
    heapDeltaBytes: heapAfterLifecycle.usedSize - heapBeforeLifecycle.usedSize
  }, null, 2));
  await page.goto('/#cctv');
  await waitForViewReady(page, 'view-cctv');
  mkdirSync('artifacts/fase25/after', { recursive: true });
  await page.locator('#view-cctv').screenshot({ path: 'artifacts/fase25/after/cctv.png' });
  expect(browserErrors).toEqual([]);
});

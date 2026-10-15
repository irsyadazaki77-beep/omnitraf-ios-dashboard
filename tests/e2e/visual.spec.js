import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { authenticateAs } from './fixtures/auth.fixture.js';
import { ROUTES } from './fixtures/test-data.js';
import { waitForViewReady, stabilizeVisualState, stabilizeMapViewport, setSimulationControl } from './fixtures/simulation.fixture.js';

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 }
];

test.describe('Phase 5 visual audit baseline and responsive contracts', () => {
  test.setTimeout(240_000);

  test('captures every view in both themes and checks responsive overflow at required sizes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Desktop-Dark', 'Responsive breakpoints and both themes are swept explicitly in one deterministic Chromium project.');
    await authenticateAs(page, 'OPERATOR');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#dashboard');
    await waitForViewReady(page, 'view-dashboard');
    const simulationPaused = await setSimulationControl(page, { action: 'pause' });
    expect(simulationPaused, 'Visual fixture must pause the isolated simulation').toBe(true);
    // A paused simulation is still connected. Do not infer an offline/stale
    // transport state from the simulation clock control.
    const stage = process.env.PHASE5_CAPTURE_STAGE || 'after';
    const artifactDir = testInfo.outputPath(`phase5-${stage}`);
    const screenshotDir = process.env.PHASE9_CAPTURE_DIR
      ? path.resolve(process.env.PHASE9_CAPTURE_DIR, stage)
      : artifactDir;
    await mkdir(artifactDir, { recursive: true });
    await mkdir(screenshotDir, { recursive: true });
    const measurements = [];
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    for (const route of ROUTES) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/${route.path}`);
      await waitForViewReady(page, route.id);
      await stabilizeVisualState(page);
      if (route.id === 'view-dashboard' || route.id === 'view-map') {
        await stabilizeMapViewport(page, route.id);
      }
      await expect(page.locator('#viewLoadError')).toBeHidden();
      await expect(page.locator('#viewContainer').locator(`#${route.id}`)).toBeVisible();

      for (const theme of ['dark', 'light']) {
        const screenshotMask = route.id === 'view-dashboard'
          ? [page.locator('#dashboardMapBox .leaflet-tile-pane')]
          : route.id === 'view-map'
            ? [page.locator('#map-surabaya .leaflet-tile-pane')]
            : route.id === 'view-cctv'
              ? [page.locator('.cctv-canvas')]
              : route.id === 'view-city3d'
                ? [page.locator('#city3dCanvasHost canvas')]
                : [];
        await page.setViewportSize({ width: 1440, height: 900 });
        const isLight = await page.locator('body').evaluate((body) => body.classList.contains('theme-light'));
        if ((theme === 'light') !== isLight) {
          await page.locator('#themeToggle').click();
          await expect.poll(() => page.locator('body').evaluate((body) => body.classList.contains('theme-light'))).toBe(theme === 'light');
          await page.locator('#toastStack .toast-item').evaluateAll((items) => items.forEach((item) => item.remove()));
        }
        await expect(page).toHaveScreenshot(`${route.id}-${theme}-desktop.png`, {
          animations: 'disabled',
          mask: screenshotMask,
          maxDiffPixelRatio: 0.15
        });
        await page.screenshot({
          path: path.join(screenshotDir, `${route.id}-${theme}-desktop.png`),
          animations: 'disabled',
          mask: screenshotMask
        });

        if (theme === 'dark') {
          await page.setViewportSize({ width: 390, height: 844 });
          await stabilizeVisualState(page);
          if (route.id === 'view-dashboard' || route.id === 'view-map') {
            await stabilizeMapViewport(page, route.id);
          }
          await expect(page).toHaveScreenshot(`${route.id}-dark-mobile.png`, {
            animations: 'disabled',
            mask: screenshotMask,
            maxDiffPixelRatio: 0.15
          });
          await page.screenshot({
            path: path.join(screenshotDir, `${route.id}-dark-mobile.png`),
            animations: 'disabled',
            mask: screenshotMask
          });
          await page.setViewportSize({ width: 1440, height: 900 });
          if (route.id === 'view-dashboard' || route.id === 'view-map') {
            await stabilizeMapViewport(page, route.id);
          }
        }

        for (const viewport of VIEWPORTS) {
          await page.setViewportSize(viewport);
          await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const metrics = await page.evaluate(({ routeId, viewport }) => {
            const view = document.getElementById(routeId);
            const shell = document.querySelector('.app-shell');
            const main = document.querySelector('main');
            const box = (element) => {
              if (!element) return null;
              const rect = element.getBoundingClientRect();
              return { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
            };
            return {
              route: routeId,
              theme: document.body.classList.contains('theme-light') ? 'light' : 'dark',
              viewport,
              documentWidth: document.documentElement.scrollWidth,
              bodyWidth: document.body.scrollWidth,
              shell: box(shell),
              main: box(main),
              view: box(view),
              viewClientWidth: view?.clientWidth ?? null,
              viewScrollWidth: view?.scrollWidth ?? null,
              dashboardDisplay: getComputedStyle(document.querySelector('#view-dashboard') || document.body).display,
              dashboardStatusElements: ['dashSystemState', 'dashHeaderProv', 'dashDataFreshness'].map((id) => {
                const element = document.getElementById(id);
                if (!element) return { id, present: false };
                const style = getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return {
                  id,
                  present: true,
                  hidden: element.hidden,
                  display: style.display,
                  visibility: style.visibility,
                  text: element.textContent.trim(),
                  background: style.backgroundColor,
                  bounds: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }
                };
              }),
              activePanes: [...document.querySelectorAll('.view-pane.active')].map((pane) => pane.id),
              inlineViewDisplay: [...document.querySelectorAll('.view-pane')].filter((pane) => pane.style.display !== '').map((pane) => pane.id),
              overlayStates: ['#staffChatPanel', '#pipCameraCard', '#engineInfoModal', '#notifDrawer'].map((selector) => {
                const element = document.querySelector(selector);
                const count = document.querySelectorAll(selector).length;
                if (!element) return { selector, present: false, count };
                const style = getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                const focusableCount = [...element.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
                  .filter((control) => control.tabIndex >= 0).length;
                return {
                  selector,
                  present: true,
                  count,
                  classes: element.className,
                  display: style.display,
                  visibility: style.visibility,
                  ariaHidden: element.getAttribute('aria-hidden'),
                  inert: element.inert,
                  focusableCount,
                  containsFocus: element.contains(document.activeElement),
                  bounds: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }
                };
              }),
              clippedControls: [...document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
                .filter((element) => {
                  const style = getComputedStyle(element);
                  if (!element.getClientRects().length || element.disabled || style.display === 'none' || style.visibility === 'hidden') return false;
                  if (element.closest('[hidden], [inert], [aria-hidden="true"], details:not([open])')) return false;
                  if (element.closest('.table-scroll, .settings-nav-list, [aria-label*="gulir horizontal"]')) return false;
                  // Leaflet positions markers outside the viewport rectangle and
                  // clips them inside its own map pane; they are not shell overflow.
                  if (element.closest('.leaflet-marker-pane')) return false;
                  const rect = element.getBoundingClientRect();
                  return rect.left < -1 || rect.right > viewport.width + 1;
                })
                .map((element) => ({ id: element.id, tag: element.tagName, className: element.className, text: element.textContent?.trim().slice(0, 60), left: Math.round(element.getBoundingClientRect().left), right: Math.round(element.getBoundingClientRect().right) }))
            };
          }, { routeId: route.id, viewport });
          measurements.push(metrics);
          expect(metrics.documentWidth, `${route.label} ${theme} ${viewport.width}x${viewport.height} document overflow`).toBeLessThanOrEqual(viewport.width + 1);
          expect(metrics.shell?.right ?? 0, `${route.label} ${theme} ${viewport.width}x${viewport.height} shell outside viewport`).toBeLessThanOrEqual(viewport.width + 1);
          expect(metrics.clippedControls, `${route.label} ${theme} ${viewport.width}x${viewport.height} controls clipped horizontally`).toEqual([]);
          expect(metrics.inlineViewDisplay, `${route.label} stale inline display`).toEqual([]);
          if (route.id === 'view-dashboard') expect(metrics.dashboardDisplay, 'Dashboard uses its authored grid layout').toBe('grid');
          if (route.id === 'view-dashboard') {
            const hiddenHeaderProvenance = metrics.dashboardStatusElements.find((element) => element.id === 'dashHeaderProv');
            expect(hiddenHeaderProvenance?.hidden).toBe(true);
            expect(hiddenHeaderProvenance?.display).toBe('none');
          }
          if (route.id !== 'view-dashboard') expect(metrics.activePanes, `${route.label} has only its route active`).toEqual([route.id]);
          for (const overlay of metrics.overlayStates) {
            expect(overlay.count, `${route.label} ${theme} duplicate ${overlay.selector}`).toBeLessThanOrEqual(1);
            if (overlay.ariaHidden === 'true' || overlay.display === 'none') {
              expect(overlay.inert, `${route.label} ${theme} hidden ${overlay.selector} must be inert`).toBe(true);
              expect(overlay.containsFocus, `${route.label} ${theme} hidden ${overlay.selector} must not contain focus`).toBe(false);
            }
          }
          if (route.id === 'view-map' && viewport.width === 390) {
            const mapLayout = await page.locator('.map-entity-workspace').evaluate((element) => getComputedStyle(element).display);
            expect(mapLayout).toBe('grid');
          }
        }
      }
      expect(pageErrors, `${route.label} page errors`).toEqual([]);
    }

    const metricsJson = JSON.stringify(measurements, null, 2);
    await writeFile(`${artifactDir}/layout-metrics.json`, metricsJson, 'utf8');
    await testInfo.attach(`phase5-${stage}-layout-metrics.json`, {
      body: Buffer.from(metricsJson),
      contentType: 'application/json'
    });
  });
});

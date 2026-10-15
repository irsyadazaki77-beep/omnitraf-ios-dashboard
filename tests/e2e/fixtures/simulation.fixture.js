/**
 * Deterministic Simulation Fixture:
 * Freezes time, disables non-essential animations, waits for lazy views & fonts,
 * and waits for application-specific readiness without requiring the realtime
 * socket to become idle.
 */

/**
 * Stabilize page for deterministic visual regression & interaction testing
 * @param {import('@playwright/test').Page} page
 */
export async function stabilizeVisualState(page) {
  // 1. Load the deterministic test overrides as a same-origin stylesheet so
  // the production CSP can keep inline styles disabled.
  await page.route('**/__e2e/stabilize.css', (route) => route.fulfill({
    status: 200,
    contentType: 'text/css; charset=utf-8',
    body: `
      *, *::before, *::after {
        animation-duration: 0.001s !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001s !important;
        caret-color: transparent !important;
      }
      .marquee-content, #marqueeContainer {
        animation: none !important;
      }
      .pulse-beacon, .radar-sweep, .cctv-scanline {
        display: none !important;
      }
    `
  }));
  const origin = new URL(page.url()).origin;
  await page.addStyleTag({ url: `${origin}/__e2e/stabilize.css` });

  // 2. Wait for fonts to finish loading
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  });

  // Let style recalculation, canvas paint, and any queued DOM writes settle.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/**
 * Pin Leaflet to the documented simulation viewport before visual capture.
 * Dashboard routes can inherit a fly-to from earlier operator actions while
 * the map instance remains mounted; resetting the instance keeps screenshots
 * independent from the previous browser interaction.
 * @param {import('@playwright/test').Page} page
 * @param {string} viewId
 */
export async function stabilizeMapViewport(page, viewId) {
  const containerId = viewId === 'view-dashboard' ? 'dashboardMapBox' : 'map-surabaya';
  await page.waitForFunction((id) => window.mapManager?.maps?.has(id), containerId, { timeout: 10000 });
  await page.evaluate((id) => {
    const map = window.mapManager?.maps?.get(id);
    if (!map) return;
    map.stop();
    map.closePopup();
    map.invalidateSize(false);
    map.setView([-7.2756, 112.7424], 13, { animate: false });
  }, containerId);
  await page.waitForFunction((id) => {
    const map = window.mapManager?.maps?.get(id);
    if (!map) return false;
    const center = map.getCenter();
    return Math.abs(center.lat + 7.2756) < 0.0001
      && Math.abs(center.lng - 112.7424) < 0.0001
      && map.getZoom() === 13;
  }, containerId);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}


/**
 * Wait for a view element to be mounted and visible
 * @param {import('@playwright/test').Page} page
 * @param {string} viewId e.g. 'view-dashboard'
 */
export async function waitForViewReady(page, viewId) {
  const result = await page.waitForFunction(
    (id) => {
      const el = document.getElementById(id);
      const error = document.getElementById('viewLoadError');
      if (error && !error.hidden) return `error: ${error.innerText}`;
      const ready = el && el.childElementCount > 0 && el.classList.contains('active')
        && !el.hidden && !el.inert && !el.classList.contains('hidden')
        && getComputedStyle(el).display !== 'none'
        && !el.hasAttribute('aria-busy');
      return ready ? 'ready' : false;
    },
    viewId,
    { timeout: 15000 }
  );
  const status = await result.jsonValue();
  if (status !== 'ready') throw new Error(`View ${viewId} failed to load: ${status}`);
}

/**
 * Configure simulation engine through API control
 * @param {import('@playwright/test').Page} page
 * @param {Object} controlParams
 */
export async function setSimulationControl(page, controlParams) {
  const response = await page.request.post('/api/diagnostics/simulation/control', {
    data: controlParams
  });
  return response.ok();
}

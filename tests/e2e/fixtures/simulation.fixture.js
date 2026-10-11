/**
 * Deterministic Simulation Fixture:
 * Freezes time, disables non-essential animations, waits for lazy views & fonts,
 * and sets up deterministic visual state.
 */

/**
 * Stabilize page for deterministic visual regression & interaction testing
 * @param {import('@playwright/test').Page} page
 */
export async function stabilizeVisualState(page) {
  // 1. Inject CSS to stop non-essential CSS animations, blinking, marquee
  await page.addStyleTag({
    content: `
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
  });

  // 2. Wait for fonts to finish loading
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  });

  // 3. Wait until no active pending network requests or DOM insertions
  await page.waitForLoadState('networkidle');
}

/**
 * Wait for a view element to be mounted and visible
 * @param {import('@playwright/test').Page} page
 * @param {string} viewId e.g. 'view-dashboard'
 */
export async function waitForViewReady(page, viewId) {
  const viewLocator = page.locator(`#${viewId}`);
  await viewLocator.waitFor({ state: 'visible', timeout: 15000 });
  // Wait for child content to have rendered
  await page.waitForFunction(
    (id) => {
      const el = document.getElementById(id);
      return el && el.childElementCount > 0 && !el.classList.contains('hidden');
    },
    viewId,
    { timeout: 15000 }
  );
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

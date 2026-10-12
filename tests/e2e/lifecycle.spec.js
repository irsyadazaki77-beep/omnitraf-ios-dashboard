import { test, expect } from '@playwright/test';
import { authenticateAs } from './fixtures/auth.fixture.js';
import { waitForViewReady } from './fixtures/simulation.fixture.js';

test('rapid lazy-route lifecycle resolves to the last requested view without duplicate panes', async ({ page }) => {
  await authenticateAs(page, 'OPERATOR');
  await page.goto('/#dashboard');
  await waitForViewReady(page, 'view-dashboard');

  for (let pass = 0; pass < 3; pass += 1) {
    await page.evaluate(() => {
      for (const route of ['map', 'cctv', 'signals', 'dashboard']) {
        document.querySelector(`.sidebar [data-view="${route}"]`)?.click();
      }
    });
    await waitForViewReady(page, 'view-dashboard');
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#dashboard');
    await expect.poll(() => page.locator('.view-pane.active').count()).toBe(1);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('#view-dashboard')).display)).toBe('grid');
    await expect(page.locator('.view-pane[aria-busy="true"]')).toHaveCount(0);
  }
});

test('direct route entry loads route CSS and keeps unrelated panes inert', async ({ page }) => {
  await authenticateAs(page, 'OPERATOR');
  await page.goto('/#dashboard');
  await waitForViewReady(page, 'view-dashboard');
  await page.goto('/#map');
  await waitForViewReady(page, 'view-map');
  const state = await page.evaluate(() => ({
    mapDisplay: getComputedStyle(document.querySelector('#view-map')).display,
    mapGrid: getComputedStyle(document.querySelector('.map-entity-workspace')).display,
    dashboardHidden: document.querySelector('#view-dashboard').hidden,
    dashboardInert: document.querySelector('#view-dashboard').inert,
    layerDisplay: getComputedStyle(document.querySelector('#fullMapLayerDeck')).display
  }));
  expect(state.mapGrid).toBe('grid');
  expect(state.dashboardHidden).toBe(true);
  expect(state.dashboardInert).toBe(true);
  expect(state.layerDisplay).toBe('none');
});

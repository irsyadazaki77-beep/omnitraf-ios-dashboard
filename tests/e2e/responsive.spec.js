import { test, expect } from '@playwright/test';
import { authenticateAs } from './fixtures/auth.fixture.js';
import { ROUTES } from './fixtures/test-data.js';
import { waitForViewReady } from './fixtures/simulation.fixture.js';

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 }
];

test('all workspaces keep the application shell and main content inside responsive viewports', async ({ page }) => {
  test.setTimeout(240_000);
  await authenticateAs(page, 'OPERATOR');
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    for (const route of ROUTES) {
      await page.goto(`/${route.path}`);
      await waitForViewReady(page, route.id);
      const bounds = await page.evaluate((viewId) => {
        const rect = (element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right, width: box.width };
        };
        const view = document.getElementById(viewId);
        const main = document.querySelector('#mainContent');
        return {
          viewportWidth: document.documentElement.clientWidth,
          documentWidth: document.documentElement.scrollWidth,
          shell: rect(document.querySelector('.app-shell')),
          main: rect(main),
          view: rect(view),
          viewWidth: view.clientWidth,
          viewScrollWidth: view.scrollWidth,
          integrationBoard: viewId === 'view-integration' ? rect(view.querySelector('.integration-board')) : null,
          integrationScrollWidth: viewId === 'view-integration' ? view.querySelector('.integration-board')?.scrollWidth ?? 0 : null,
          integrationClientWidth: viewId === 'view-integration' ? view.querySelector('.integration-board')?.clientWidth ?? 0 : null,
          integrationOverflowers: viewId === 'view-integration' ? [...view.querySelectorAll('*')]
            .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1)
            .map((element) => ({ tag: element.tagName, id: element.id, className: String(element.className), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth })) : []
        };
      }, route.id);
      expect(bounds.documentWidth, `${route.label} document ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(viewport.width + 1);
      expect(bounds.shell.left, `${route.label} shell left edge`).toBeGreaterThanOrEqual(-1);
      expect(bounds.shell.right, `${route.label} shell right edge`).toBeLessThanOrEqual(viewport.width + 1);
      if (route.id === 'view-integration') {
        expect(bounds.integrationBoard?.right, `${route.label} board remains within main content`).toBeLessThanOrEqual(bounds.main.right + 1);
        expect(bounds.integrationScrollWidth, `${route.label} internal sandbox width ${JSON.stringify(bounds.integrationOverflowers)}`).toBeLessThanOrEqual(bounds.integrationClientWidth + 1);
      }
    }
  }
});

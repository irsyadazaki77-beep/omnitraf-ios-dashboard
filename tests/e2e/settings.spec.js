import { test, expect } from '@playwright/test';
import { authenticateAs } from './fixtures/auth.fixture.js';
import { AppShellPage } from './pages/appShell.page.js';
import { waitForViewReady } from './fixtures/simulation.fixture.js';

test('Settings category navigation is keyboard reachable and theme remains synchronized', async ({ page }) => {
  await authenticateAs(page, 'ADMIN');
  await page.goto('/#settings');
  await waitForViewReady(page, 'view-settings');
  const categories = page.locator('#view-settings .settings-nav-item');
  const category = categories.first();
  await expect(category).toBeVisible();
  await category.focus();
  await expect(category).toBeFocused();

  const shell = new AppShellPage(page);
  await shell.toggleTheme();
  await expect(page.locator('body')).toHaveClass(/theme-light/);
  await expect(shell.themeToggle).toHaveAttribute('aria-pressed', 'true');
  const layout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    categoryNavWidth: document.querySelector('.settings-nav-list')?.clientWidth ?? 0,
    categoryNavScrollWidth: document.querySelector('.settings-nav-list')?.scrollWidth ?? 0
  }));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.categoryNavWidth).toBeGreaterThan(0);
  if (layout.categoryNavScrollWidth > layout.categoryNavWidth) {
    await page.locator('.settings-nav-list').evaluate((nav) => { nav.scrollLeft = nav.scrollWidth; });
    expect(await page.locator('.settings-nav-list').evaluate((nav) => nav.scrollLeft)).toBeGreaterThan(0);
  }
});

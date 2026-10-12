import { test, expect } from '@playwright/test';
import { authenticateAs } from './fixtures/auth.fixture.js';
import { AppShellPage } from './pages/appShell.page.js';
import { waitForViewReady } from './fixtures/simulation.fixture.js';

test.describe('Application navigation and shell preferences', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, 'OPERATOR');
    await page.goto('/#dashboard');
    await waitForViewReady(page, 'view-dashboard');
  });

  test('sidebar collapse changes the shell grid and persists across reload', async ({ page }) => {
    test.skip(await page.evaluate(() => matchMedia('(max-width: 768px)').matches), 'Mobile uses a drawer; it does not expose desktop sidebar collapse.');
    const shell = new AppShellPage(page);
    await page.evaluate(() => localStorage.removeItem('omnitraf.sidebar.collapsed'));
    await page.reload();
    await waitForViewReady(page, 'view-dashboard');
    expect(await shell.isSidebarCollapsed()).toBe(false);

    await shell.toggleSidebar();
    await expect.poll(() => shell.isSidebarCollapsed()).toBe(true);
    await expect.poll(() => page.locator('.app-shell').evaluate((node) => getComputedStyle(node).gridTemplateColumns)).toContain('68px');
    await page.reload();
    await waitForViewReady(page, 'view-dashboard');
    expect(await shell.isSidebarCollapsed()).toBe(true);
  });

  test('mobile destination drawer opens, navigates, and closes on selection', async ({ page }) => {
    test.skip(!(await page.evaluate(() => matchMedia('(max-width: 768px)').matches)), 'Mobile drawer contract only applies at mobile/tablet widths.');
    const shell = new AppShellPage(page);
    const sidebar = page.locator('#sidebar');
    await expect(sidebar).not.toHaveClass(/open-mobile/);
    await page.locator('#mobTabMenu:visible, #menuToggle:visible').first().click();
    await expect(sidebar).toHaveClass(/open-mobile/);
    await expect(page.locator('#menuToggle')).toHaveAttribute('aria-expanded', 'true');
    await shell.navigateTo('cctv');
    await waitForViewReady(page, 'view-cctv');
    await expect(sidebar).not.toHaveClass(/open-mobile/);
    await expect(await shell.expectActiveNavigation('cctv')).toHaveAttribute('aria-current', 'page');
  });

  test('theme toggle changes the rendered theme and persists after reload', async ({ page }) => {
    const shell = new AppShellPage(page);
    await shell.toggleTheme();
    await expect(page.locator('body')).toHaveClass(/theme-light/);
    await expect(shell.themeToggle).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await waitForViewReady(page, 'view-dashboard');
    await expect(page.locator('body')).toHaveClass(/theme-light/);
    await shell.toggleTheme();
    await expect(page.locator('body')).not.toHaveClass(/theme-light/);
  });

  test('rapid route selections leave one active pane at the final destination', async ({ page }) => {
    await page.evaluate(() => {
      for (const route of ['map', 'cctv', 'signals', 'dashboard']) {
        document.querySelector(`.sidebar [data-view="${route}"]`)?.click();
      }
    });
    await waitForViewReady(page, 'view-dashboard');
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#dashboard');
    const result = await page.evaluate(() => ({
      active: [...document.querySelectorAll('.view-pane.active')].map((pane) => pane.id),
      visible: [...document.querySelectorAll('.view-pane')].filter((pane) => getComputedStyle(pane).display !== 'none').map((pane) => pane.id),
      dashboardDisplay: getComputedStyle(document.querySelector('#view-dashboard')).display,
      hasInlineDisplay: [...document.querySelectorAll('.view-pane')].some((pane) => pane.style.display !== '')
    }));
    expect(result.active).toEqual(['view-dashboard']);
    expect(result.visible).toEqual(['view-dashboard']);
    expect(result.dashboardDisplay).toBe('grid');
    expect(result.hasInlineDisplay).toBe(false);
  });

  test('navigation selection follows the visible pane and active link', async ({ page }) => {
    const shell = new AppShellPage(page);
    await shell.navigateTo('cctv');
    await waitForViewReady(page, 'view-cctv');
    const activeLink = await shell.expectActiveNavigation('cctv');
    await expect(activeLink).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#view-dashboard')).toBeHidden();
  });
});

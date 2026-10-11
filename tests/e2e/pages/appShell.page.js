export class AppShellPage {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;
    this.sidebar = page.locator('#sidebar');
    this.sidebarCollapseToggle = page.locator('#sidebarCollapseToggle');
    this.topbar = page.locator('.topbar, header.topbar');
    this.brandLogo = page.locator('.brand');
    this.quickNavButton = page.locator('#quickNavigationButton');
    this.themeToggle = page.locator('#themeToggle');
    this.navMenu = page.locator('.nav-menu');
    this.mobileDrawer = page.locator('.drawer-backdrop');
  }

  async goto() {
    await this.page.goto('/');
  }

  async navigateTo(viewName) {
    // viewName could be dashboard, map, cctv, signals, incidents, emergency, devices, analytics, prediction, reports, integration, settings
    const navItem = this.page.locator(`a.nav-item[data-view="${viewName}"], a.nav-item[href="#${viewName}"]`).first();
    await navItem.waitFor({ state: 'visible' });
    await navItem.click();
  }

  async toggleTheme() {
    const toggle = this.page.locator('#themeToggle, [data-action="toggle-theme"]').first();
    await toggle.waitFor({ state: 'visible' });
    await toggle.click();
  }

  async isSidebarCollapsed() {
    return this.page.evaluate(() => {
      const sidebar = document.getElementById('sidebar');
      return document.body.classList.contains('sidebar-collapsed') || sidebar?.classList.contains('collapsed');
    });
  }

  async toggleSidebar() {
    await this.sidebarCollapseToggle.click();
  }
}

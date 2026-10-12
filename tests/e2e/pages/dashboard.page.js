import { waitForViewReady } from '../fixtures/simulation.fixture.js';

export class DashboardPage {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;
    this.viewContainer = page.locator('#view-dashboard');
    this.kpiCards = page.locator('#view-dashboard .dashboard-kpi');
    this.status = page.locator('#dashSystemState');
    this.map = page.locator('#dashboardMapBox');
    this.priorityPanel = page.locator('#priorityOperationsList');
    this.criticalStrip = page.locator('#criticalIncidentStrip');
    this.searchDisclosure = page.locator('.dashboard-map-search');
    this.searchInput = page.locator('#intersectionSearch');
    this.advancedControls = page.locator('#dashboardSimulationTools');
    this.refreshButton = page.locator('#view-dashboard [data-action="refresh"]');
  }

  async waitForReady() {
    await waitForViewReady(this.page, 'view-dashboard');
  }

  async getKpiCount() {
    return this.kpiCards.count();
  }

  async searchIntersection(query) {
    const isOpen = await this.searchDisclosure.evaluate((details) => details.open);
    if (!isOpen) {
      await this.searchDisclosure.locator('summary').click();
    }
    await this.searchInput.fill(query);
  }

  async openAdvancedControls() {
    if (!(await this.advancedControls.getAttribute('open'))) {
      await this.advancedControls.locator('summary').click();
    }
  }

  async refresh() {
    await this.refreshButton.click();
  }
}

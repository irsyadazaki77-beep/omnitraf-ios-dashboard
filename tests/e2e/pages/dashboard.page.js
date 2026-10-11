import { waitForViewReady } from '../fixtures/simulation.fixture.js';

export class DashboardPage {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;
    this.viewContainer = page.locator('#view-dashboard');
    this.kpiCards = page.locator('#view-dashboard .metric-card, #view-dashboard .kpi-card');
    this.incidentFeed = page.locator('#view-dashboard .incident-feed, #view-dashboard #dashboardIncidents');
    this.quickActions = page.locator('#view-dashboard .quick-actions, #view-dashboard [data-action]');
  }

  async waitForReady() {
    await waitForViewReady(this.page, 'view-dashboard');
  }

  async getKpiCount() {
    return this.kpiCards.count();
  }
}

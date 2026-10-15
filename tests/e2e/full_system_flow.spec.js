import { test, expect } from '@playwright/test';
import { authenticateAs, logoutUser } from './fixtures/auth.fixture.js';
import { TEST_USERS } from './fixtures/test-data.js';
import { waitForViewReady } from './fixtures/simulation.fixture.js';

test.describe('E2E Full Lifecycle: Login -> 13 Views Navigation -> RBAC Verification -> Logout', () => {
  const VIEWS_SEQUENCE = [
    { name: 'Dashboard', hash: '#dashboard', id: 'view-dashboard' },
    { name: 'Map', hash: '#map', id: 'view-map' },
    { name: 'CCTV', hash: '#cctv', id: 'view-cctv' },
    { name: 'City3D', hash: '#city3d', id: 'view-city3d' },
    { name: 'Signals', hash: '#signals', id: 'view-signals' },
    { name: 'Incidents', hash: '#incidents', id: 'view-incidents' },
    { name: 'Emergency', hash: '#emergency', id: 'view-emergency' },
    { name: 'Devices', hash: '#devices', id: 'view-devices' },
    { name: 'Analytics', hash: '#analytics', id: 'view-analytics' },
    { name: 'Prediction', hash: '#prediction', id: 'view-prediction' },
    { name: 'Reports', hash: '#reports', id: 'view-reports' },
    { name: 'Integrations', hash: '#integration', id: 'view-integration' },
    { name: 'Settings', hash: '#settings', id: 'view-settings' },
  ];

  test('complete operator journey across all 13 workspaces followed by session logout', async ({ page }) => {
    // 1. Login as Operator
    await authenticateAs(page, 'OPERATOR');
    await page.goto('/#dashboard');
    await waitForViewReady(page, 'view-dashboard');

    // 2. Sequential journey across all 12 workspaces
    for (const view of VIEWS_SEQUENCE) {
      await page.goto(`/${view.hash}`);
      await waitForViewReady(page, view.id);
      const pane = page.locator(`#${view.id}`);
      await expect(pane).toBeVisible();
      await expect(pane).toHaveClass(/active/);
    }

    // 3. Clean Session Logout
    await logoutUser(page);
    const unauthCheck = await page.request.get('/api/auth/me');
    expect(unauthCheck.status()).toBe(401);
  });

  test('comprehensive RBAC audit: Viewer is rejected on mutations while Operator & Admin succeed', async ({ page }) => {
    // 1. Viewer attempt to mutate emergency or incident
    await authenticateAs(page, 'VIEWER');
    const viewerEmergencyDispatch = await page.request.post('/api/emergencies', {
      data: { routeId: 'route-darmo-urgent', vehicleType: 'AMBULANCE' }
    });
    expect([401, 403]).toContain(viewerEmergencyDispatch.status());

    const viewerCreateIncident = await page.request.post('/api/incidents', {
      data: { title: 'Uji Coba Insiden', location: 'Simpang Darmo' }
    });
    expect([401, 403]).toContain(viewerCreateIncident.status());

    // 2. Operator allowed operational commands
    await authenticateAs(page, 'OPERATOR');
    const operatorSimControl = await page.request.post('/api/diagnostics/simulation/control', {
      data: { action: 'pause' }
    });
    expect(operatorSimControl.status()).toBe(200);

    // Resume simulation
    await page.request.post('/api/diagnostics/simulation/control', {
      data: { action: 'resume' }
    });

    // 3. Admin has full administrative capabilities
    await authenticateAs(page, 'ADMIN');
    const adminSimControl = await page.request.post('/api/diagnostics/simulation/control', {
      data: { action: 'resume' }
    });
    expect(adminSimControl.status()).toBe(200);
  });
});

import { test, expect } from '@playwright/test';
import { authenticateAs } from './fixtures/auth.fixture.js';
import { waitForViewReady } from './fixtures/simulation.fixture.js';

test.describe('Operational workspace interactions', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, 'OPERATOR');
  });

  test('Dashboard priority incident opens the matching incident inspector', async ({ page }) => {
    await page.goto('/#dashboard');
    await waitForViewReady(page, 'view-dashboard');
    const incident = page.locator('#priorityOperationsList .priority-operation[data-entity-kind="incident"]').first();
    await expect(incident).toBeVisible({ timeout: 15000 });
    const incidentId = await incident.getAttribute('data-entity-id');
    await incident.click();
    await waitForViewReady(page, 'view-incidents');
    await expect(page.locator('#incidentInspector')).toBeVisible();
    await expect(page.locator('#incidentInspectorProperties')).toContainText('Simpang demo');
    await expect(page.locator('#incidentInspectorTitle')).not.toBeEmpty();
  });

  test('3D city mode exposes camera controls and returns to the existing 2D Map', async ({ page }) => {
    await page.goto('/#city3d');
    await waitForViewReady(page, 'view-city3d');
    const canvas = page.locator('#city3dCanvasHost canvas');
    const fallback = page.locator('#city3dFallback');
    await expect.poll(async () => (await canvas.count()) > 0 || await fallback.isVisible()).toBeTruthy();
    if (await canvas.count()) {
      await page.locator('[data-camera-view="top"]').click();
      await expect(page.locator('[data-camera-view="top"]')).toHaveClass(/is-active/);
      await page.locator('[data-camera-view="street"]').click();
      await expect(page.locator('[data-camera-view="street"]')).toHaveClass(/is-active/);
      await page.locator('[data-camera-view="isometric"]').click();
      await expect(page.locator('#city3dFps')).toHaveText(/\d+ FPS/, { timeout: 10000 });
      await page.screenshot({ path: 'artifacts/phase15-city3d-after.png', fullPage: true });
      await page.locator('#city3dCameraSelect').selectOption({ index: 1 });
      await expect(page.locator('#city3dCctvPreview')).toContainText('Virtual camera');
      await page.locator('#city3dStage').screenshot({ path: 'artifacts/phase15-city3d-camera-preview.png' });
    }
    await page.locator('.city3d-map-link').click();
    await waitForViewReady(page, 'view-map');
    await expect(page.locator('#map-surabaya')).toBeVisible();
  });

  test('3D city mode offers the Leaflet fallback when WebGL2 is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type === 'webgl2') return null;
        return getContext.call(this, type, ...args);
      };
    });
    await page.goto('/#city3d');
    await waitForViewReady(page, 'view-city3d');
    await expect(page.locator('#city3dFallback')).toBeVisible();
    await page.locator('#city3dFallback a[data-view="map"]').click();
    await waitForViewReady(page, 'view-map');
    await expect(page.locator('#map-surabaya')).toBeVisible();
  });

  test('incident selection opens the matching inspector and close restores focus', async ({ page }) => {
    await page.goto('/#incidents');
    await waitForViewReady(page, 'view-incidents');
    const detailButton = page.locator('#incidentLogsList .incident-detail-btn').first();
    await expect(detailButton).toBeVisible();
    const label = await detailButton.getAttribute('aria-label');
    await detailButton.click();
    await expect(page.locator('#incidentInspector')).toBeVisible();
    await expect(page.locator('#incidentInspectorTitle')).toHaveText(label.replace('Lihat detail ', ''));
    await page.locator('#btnCloseIncidentInspector').click();
    await expect(page.locator('#incidentInspector')).toBeHidden();
    await expect(detailButton).toBeFocused();
  });

  test('signal row routes to the exact intersection on Map', async ({ page }) => {
    await page.goto('/#signals');
    await waitForViewReady(page, 'view-signals');
    const targetRow = page.locator('#intersectionTable tr[data-intersection-id="node-wonokromo"]');
    await expect(targetRow).toBeVisible();
    const targetName = (await targetRow.locator('td').first().innerText()).trim();
    await targetRow.click();
    await waitForViewReady(page, 'view-map');
    await expect(page.locator('#mapEntityInspector')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#mapInspectorTitle')).toContainText(targetName);
    await expect(page.locator('#mapInspectorLinks')).toBeVisible();
  });

  test('device selection opens the matching device drawer and closes cleanly', async ({ page }) => {
    await page.goto('/#devices');
    await waitForViewReady(page, 'view-devices');
    const row = page.locator('#deviceTableBody .device-row').first();
    await expect(row).toBeVisible();
    const deviceId = await row.getAttribute('data-device');
    await row.locator('.btn-device-detail').click();
    const drawer = page.locator('#deviceDrawerConfig');
    await expect(drawer).toHaveClass(/open/);
    await expect(drawer).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('#deviceConfigTitle')).not.toBeEmpty();
    await page.locator('#closeDeviceDrawer').click();
    await expect(drawer).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator(`#deviceTableBody .device-row[data-device="${deviceId}"]`)).toBeVisible();
  });

  test('Dashboard emergency priority opens the exact active simulation entity', async ({ page }) => {
    const emergencyId = `E2E-CTX-${Date.now()}`;
    await page.goto('/#emergency');
    await waitForViewReady(page, 'view-emergency');
    await page.locator('#respName').fill(emergencyId);
    await page.locator('#emergencyActuatorForm').evaluate((form) => form.requestSubmit());
    const confirm = page.locator('#btnConfirmGreenWaveModal');
    await expect(confirm).toBeVisible();
    const modal = page.locator('#greenWaveConfirmModal');
    await expect(modal).toHaveAttribute('aria-hidden', 'false');
    await expect(modal).not.toHaveJSProperty('inert', true);
    await confirm.click();
    await expect(modal).toBeHidden();
    await expect(page.locator('#respName')).toBeFocused();
    const card = page.locator(`#emergencyListGrid [data-emergency-id="${emergencyId}"]`);
    await expect(card).toBeVisible({ timeout: 15000 });

    await page.goto('/#dashboard');
    await waitForViewReady(page, 'view-dashboard');
    const priority = page.locator(`#priorityOperationsList .priority-operation[data-entity-kind="emergency"][data-entity-id="${emergencyId}"]`);
    await expect(priority).toBeVisible({ timeout: 10000 });
    await priority.click();
    await waitForViewReady(page, 'view-emergency');
    await expect.poll(() => page.evaluate(() => document.activeElement?.dataset?.emergencyId)).toBe(emergencyId);

    await page.locator('#btnStop112Sim').click();
    await expect(card).toBeHidden({ timeout: 15000 });
  });

  test('Map layer drawer is keyboard dismissible and restores focus to its trigger', async ({ page }) => {
    await page.goto('/#map');
    await waitForViewReady(page, 'view-map');
    const toggle = page.locator('#btnToggleFullMapLayers');
    const drawer = page.locator('#fullMapLayerDeck');
    await toggle.click();
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute('aria-hidden', 'false');
    await expect(drawer).not.toHaveJSProperty('inert', true);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(drawer).toHaveAttribute('aria-hidden', 'true');
    await expect(toggle).toBeFocused();
  });
});

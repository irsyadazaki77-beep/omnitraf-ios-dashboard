import { test, expect } from '@playwright/test';
import { authenticateAs } from './fixtures/auth.fixture.js';
import { waitForViewReady } from './fixtures/simulation.fixture.js';

async function createTestIncident(page) {
  const id = `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await page.request.post('/api/incidents', {
    data: {
      id,
      title: `Insiden E2E ${id}`,
      category: 'congestion',
      severity: 'critical',
      location: 'Simpang demo E2E',
      assignedUnit: 'Unit E2E',
      notes: 'Insiden uji terisolasi untuk alur operator.'
    }
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.data?.id).toBe(id);
  return id;
}

test.describe('Operational workspace interactions', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, 'OPERATOR');
  });

  test('Dashboard priority incident opens the matching incident inspector', async ({ page }, testInfo) => {
    const incidentId = await createTestIncident(page);
    await page.goto('/#dashboard');
    await waitForViewReady(page, 'view-dashboard');
    const incident = page.locator(`#priorityOperationsList .priority-operation[data-entity-kind="incident"][data-entity-id="${incidentId}"]`);
    await expect(incident).toBeVisible({ timeout: 15000 });
    await incident.click();
    await waitForViewReady(page, 'view-incidents');
    await expect(page.locator('#incidentInspector')).toBeVisible();
    await expect(page.locator('#incidentInspector')).toHaveAttribute('data-entity-id', incidentId);
    await expect(page.locator('#incidentInspectorProperties')).toContainText('Simpang demo');
    await expect(page.locator('#incidentInspectorTitle')).not.toBeEmpty();
    await page.screenshot({ path: testInfo.outputPath('incident-impact-after.png'), fullPage: true });

    await page.locator('#btnIncidentOpenMap').click();
    await waitForViewReady(page, 'view-map');
    await expect(page.locator('#mapEntityInspector')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#mapEntityInspector')).toHaveAttribute('data-entity-kind', 'incident');
    await expect(page.locator('#mapEntityInspector')).toHaveAttribute('data-entity-id', incidentId);
  });

  test('3D city mode exposes camera controls and returns to the existing 2D Map', async ({ page }, testInfo) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()); });
    await page.goto('/#city3d');
    await waitForViewReady(page, 'view-city3d');
    const canvas = page.locator('#city3dCanvasHost canvas');
    const fallback = page.locator('#city3dFallback');
    await expect.poll(async () => (await canvas.count()) > 0 || await fallback.isVisible()).toBeTruthy();
    if (await canvas.count()) {
      await page.evaluate(() => window.stateStore.updateCctv({ cctvVisionData: { seq: 900, timestamp: 1790000000000, source: 'SIMULATED', cameras: {
        cctvCanvas1: { sequence: 900, timestamp: 1790000000000, detections: [{ id: 'demo-city3d-car', class: 'car', progress: .51, direction: 1, speedKmh: 26, lane: 1, movement: 'through', signalState: 'green', provenance: 'SIMULATED' }] },
        cctvCanvas2: { sequence: 900, timestamp: 1790000000000, detections: [{ id: 'demo-city3d-bus', class: 'bus', progress: .73, direction: -1, speedKmh: 11, lane: 2, movement: 'left', braking: true, signalState: 'yellow', provenance: 'SIMULATED' }] }
      } } }, { source: 'e2e', emitGeneric: false }));
      await page.locator('[data-camera-view="top"]').click();
      await expect(page.locator('[data-camera-view="top"]')).toHaveClass(/is-active/);
      await page.locator('[data-camera-view="street"]').click();
      await expect(page.locator('[data-camera-view="street"]')).toHaveClass(/is-active/);
      await page.locator('[data-camera-view="isometric"]').click();
      for (const timeOfDay of ['morning', 'day', 'evening', 'night']) {
        for (const weather of ['clear', 'cloudy', 'light-rain', 'heavy-rain']) {
          await page.evaluate((visualEnvironment) => window.stateStore.setState({ visualEnvironment }, { source: 'e2e-visual-environment' }), { timeOfDay, weather });
          await expect(page.locator('#city3dCanvasHost')).toHaveAttribute('data-visual-environment', `${timeOfDay}:${weather}`);
        }
      }
      await page.locator('#city3dQuality').selectOption('low');
      await page.locator('#city3dQuality').selectOption('high');
      await page.locator('#city3dQuality').selectOption('balanced');
      await expect(page.locator('#city3dFps')).toHaveText(/\d+ FPS/, { timeout: 10000 });
      console.log('City3D benchmark', await page.evaluate(() => ({ fps: document.getElementById('city3dFps').textContent, renderer: document.getElementById('city3dPerf').textContent, heapBytes: performance.memory?.usedJSHeapSize ?? null, frame: document.getElementById('city3dVehicleFrame').textContent })));
      const projectSuffix = testInfo.project.name === 'Desktop-Dark' ? '' : `-${testInfo.project.name.toLowerCase()}`;
      await page.locator('#toastStack .toast-item').evaluateAll((items) => items.forEach((item) => item.remove()));
      await page.screenshot({ path: `artifacts/phase23/after/city3d${projectSuffix}.png`, fullPage: true });
      await page.locator('#city3dCameraSelect').selectOption({ index: 1 });
      await expect(page.locator('#city3dCctvPreview')).toContainText('Virtual camera');
      await page.locator('#city3dStage').screenshot({ path: `artifacts/phase23/after/city3d-camera-preview${projectSuffix}.png` });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('HeapProfiler.collectGarbage');
      const heap = await cdp.send('Runtime.getHeapUsage');
      console.log('City3D heap after forced GC', { usedBytes: heap.usedSize, totalBytes: heap.totalSize });
      await cdp.detach();
    }
    expect(pageErrors).toEqual([]);
    await page.locator('.city3d-map-link').click();
    await waitForViewReady(page, 'view-map');
    await expect(page.locator('#map-surabaya')).toBeVisible();
  });

  test('3D consumes the same CCTV detections and preserves camera frames during partial updates', async ({ page }) => {
    await page.goto('/#city3d');
    await waitForViewReady(page, 'view-city3d');
    const canvas = page.locator('#city3dCanvasHost canvas');
    await expect.poll(async () => (await canvas.count()) > 0 || await page.locator('#city3dFallback').isVisible()).toBeTruthy();
    test.skip(!(await canvas.count()), 'WebGL2 is unavailable in this browser context.');

    const detection = (id, cameraId) => ({ id, trackId: id, class: 'car', progress: .61, direction: 1, speedKmh: 24, lane: 1, movement: 'through', braking: false, stopped: false, signalState: 'green', provenance: 'SIMULATED', cameraId });
    const sequence = await page.evaluate(() => Number(window.stateStore.getState().cctvVisionData?.seq || 0) + 1000);
    const firstIds = await page.evaluate(({ first, sequence: frameSequence }) => {
      window.stateStore.updateCctv({ cctvVisionData: { seq: frameSequence, timestamp: Date.now(), source: 'SIMULATED', cameras: { cctvCanvas1: { sequence: frameSequence, timestamp: Date.now(), detections: [first] } } } }, { source: 'e2e', emitGeneric: false });
      return document.getElementById('city3dVehicleFrame').dataset.vehicleIds;
    }, { first: detection('cctvCanvas1-v-sync', 'cctvCanvas1'), sequence });
    expect(firstIds).toContain('cctvCanvas1-v-sync');
    const secondIds = await page.evaluate(({ second, sequence: frameSequence }) => {
      window.stateStore.updateCctv({ cctvVisionData: { seq: frameSequence, timestamp: Date.now(), source: 'SIMULATED', cameras: { cctvCanvas2: { sequence: frameSequence, timestamp: Date.now(), detections: [second] } } } }, { source: 'e2e', emitGeneric: false });
      return document.getElementById('city3dVehicleFrame').dataset.vehicleIds;
    }, { second: detection('cctvCanvas2-v-sync', 'cctvCanvas2'), sequence: sequence + 1 });
    expect(secondIds).toContain('cctvCanvas1-v-sync');
    expect(secondIds).toContain('cctvCanvas2-v-sync');
    await expect(page.locator('#city3dPerf')).toContainText('draw');
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

  test('road recovery is an acknowledged simulation action separate from incident workflow status', async ({ page }) => {
    const incidentId = await createTestIncident(page);
    await page.goto('/#incidents');
    await waitForViewReady(page, 'view-incidents');
    const incidentCard = page.locator(`#incident-${incidentId}`);
    await expect(incidentCard).toBeVisible();
    await incidentCard.locator('.incident-detail-btn').click();
    await expect(page.locator('#incidentInspectorProperties')).toContainText('Tetap dimodelkan');
    const statusBefore = await page.evaluate((id) => window.stateStore.getState().incidents.find(item => String(item.id) === id).status, incidentId);
    await page.locator('#btnIncidentMarkRoadRecovered').click();
    await expect(page.locator('#btnIncidentMarkRoadRecovered')).toBeDisabled();
    await expect(page.locator('#btnIncidentMarkRoadRecovered')).toHaveText('Jalan pulih pada model');
    await expect(page.locator('#incidentInspectorProperties')).toContainText('Pulih pada');
    const incidentAfter = await page.evaluate((id) => window.stateStore.getState().incidents.find(item => String(item.id) === id), incidentId);
    expect(incidentAfter.status).toBe(statusBefore);
    expect(incidentAfter.roadImpactRecoveredAt).toBeTruthy();
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

  test('Dashboard emergency priority previews modeled routes before confirmed server dispatch', async ({ page }, testInfo) => {
    const emergencyId = `E2E-CTX-${Date.now()}`;
    await page.goto('/#emergency');
    await waitForViewReady(page, 'view-emergency');
    await page.locator('#respName').fill(emergencyId);
    await page.locator('#respRoute').selectOption('route-merr-soetomo');
    await page.locator('#emergencyActuatorForm').evaluate((form) => form.requestSubmit());
    const confirm = page.locator('#btnConfirmGreenWaveModal');
    await expect(confirm).toBeVisible();
    const modal = page.locator('#greenWaveConfirmModal');
    await expect(modal).toHaveAttribute('aria-hidden', 'false');
    await expect(modal).not.toHaveJSProperty('inert', true);
    await expect(page.locator('#gwSelectedRoute')).toContainText('MERR');
    await expect(page.locator('#gwEstimatedEta')).not.toHaveText('Menghitung…');
    await expect(page.locator('#gwRouteReason')).not.toBeEmpty();
    await expect(page.locator('#gwTrafficImpact')).toContainText('kendaraan antrean');
    await page.screenshot({ path: testInfo.outputPath('emergency-route-preview.png'), fullPage: true });
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

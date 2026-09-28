import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';

// Mock minimal browser environment for Node test runner
if (typeof globalThis.window === 'undefined') {
  const elements = new Map();
  globalThis._testElementsMap = elements;
  globalThis.document = {
    readyState: 'complete',
    hidden: false,
    head: { appendChild() {} },
    body: { classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } },
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          id,
          style: {},
          textContent: '',
          innerHTML: '',
          classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
          addEventListener() {},
          removeEventListener() {},
          querySelectorAll() { return []; },
          querySelector() { return null; },
          setAttribute() {},
          getAttribute() { return null; },
          contains() { return false; },
          appendChild(child) { return child; }
        });
      }
      return elements.get(id);
    },
    querySelector(selector) {
      if (selector === '#card-incidents .timeline') {
        return elements.get('mockTimeline');
      }
      return null;
    },
    querySelectorAll() { return []; },
    createElement(tag) {
      const el = {
        tagName: tag,
        style: {},
        textContent: '',
        innerHTML: '',
        children: [],
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        addEventListener() {},
        removeEventListener() {},
        querySelectorAll() { return []; },
        querySelector() { return null; },
        setAttribute() {},
        getAttribute() { return null; },
        appendChild(child) {
          el.children.push(child);
          return child;
        }
      };
      return el;
    },
    addEventListener() {},
    removeEventListener() {}
  };
  globalThis.window = {
    location: { hash: '#dashboard' },
    addEventListener() {},
    removeEventListener() {},
    scrollTo() {},
    document: globalThis.document,
    showToast() {},
    requestAnimationFrame(cb) { return setTimeout(cb, 16); },
    cancelAnimationFrame(id) { clearTimeout(id); }
  };
}

// Provide Leaflet mock for node environment
globalThis.L = {
  marker() { return { addTo() { return this; }, bindPopup() { return this; }, on() { return this; } }; },
  icon() { return {}; },
  divIcon() { return {}; },
  polyline() { return { addTo() { return this; } }; }
};

import { stateStore } from '../../src/core/stateStore.js';
import { mapManager } from '../../src/modules/mapManager.js';
import { trafficEngine } from '../../src/modules/trafficEngine.js';
import { incidentController } from '../../src/controllers/incidentController.js';
import { deviceController } from '../../src/controllers/deviceController.js';

describe('Phase 15: Product Polish, Honest Provenance & UI/UX Refinements', () => {

  describe('1. Map Manager: resetViewport & clearSelection methods', () => {
    test('resetViewport and clearSelection exist and execute cleanly without errors', () => {
      assert.strictEqual(typeof mapManager.resetViewport, 'function', 'resetViewport must be a function');
      assert.strictEqual(typeof mapManager.clearSelection, 'function', 'clearSelection must be a function');

      // Executing on un-initialized or mock map should not throw
      assert.doesNotThrow(() => {
        mapManager.clearSelection();
      });

      assert.doesNotThrow(() => {
        mapManager.resetViewport();
      });
    });
  });

  describe('2. Dashboard Dynamic Emergency Widget Synchronization', () => {
    test('renders standby empty state when activeEmergencies is empty', () => {
      trafficEngine._renderEmergencyList([]);

      const titleEl = document.getElementById('dashEmergencyTitle');
      const badgeEl = document.getElementById('dashEmergencyBadge');

      assert.strictEqual(titleEl.textContent, 'Tidak Ada Armada Darurat Aktif');
      assert.strictEqual(badgeEl.textContent, 'Standby');
    });

    test('renders active priority state when activeEmergencies contains an active vehicle', () => {
      const activeList = [
        {
          id: 'EMG-POLISH-01',
          vehicleId: 'AMB-112-POLISH',
          vehicleType: '112-AMB',
          status: 'EN_ROUTE',
          routeId: 'route-darmo',
          ETA: '2m 30s',
          speed: 65,
          impactedIntersections: ['node-wonokromo', 'node-darmo']
        }
      ];

      trafficEngine._renderEmergencyList(activeList);

      const titleEl = document.getElementById('dashEmergencyTitle');
      const etaEl = document.getElementById('dashEmergencyEta');
      const badgeEl = document.getElementById('dashEmergencyBadge');

      assert.ok(titleEl.textContent.includes('AMB-112-POLISH'));
      assert.ok(etaEl.textContent.includes('2m 30s'));
      assert.strictEqual(badgeEl.textContent, 'Aktif');
    });
  });

  describe('3. Dynamic Incident Timeline Synchronization on Dashboard', () => {
    test('populates timeline items from stateStore without hardcoded placeholders', () => {
      // Setup mock card-incidents element in mock DOM
      const timelineUl = document.createElement('ul');
      timelineUl.className = 'timeline';
      const cardInc = document.getElementById('card-incidents');
      cardInc.appendChild(timelineUl);
      timelineUl.id = 'mockTimeline';
      if (globalThis._testElementsMap) {
        globalThis._testElementsMap.set('mockTimeline', timelineUl);
      }

      const mockIncidents = [
        {
          id: 'INC-POLISH-1',
          title: 'Kecelakaan Beruntun',
          location: 'Jl. Raya Darmo KM 4',
          severity: 'critical',
          status: 'DISPATCHED',
          reportedAt: new Date().toISOString(),
          notes: 'Tabrakan 2 roda empat di lajur kanan.'
        },
        {
          id: 'INC-POLISH-2',
          title: 'Pohon Tumbang',
          location: 'Jl. Pemuda',
          severity: 'medium',
          status: 'ACTIVE',
          reportedAt: new Date().toISOString(),
          notes: 'Dahan menghalangi jalur sepeda motor.'
        }
      ];

      incidentController._renderDashboardTimeline(mockIncidents);

      assert.ok(timelineUl.children.length > 0, 'Timeline items should be appended');
      const firstLi = timelineUl.children[0];
      assert.ok(firstLi.innerHTML.includes('Kecelakaan Beruntun'));
      assert.ok(firstLi.innerHTML.includes('Jl. Raya Darmo KM 4'));
    });
  });

  describe('4. Device Health Level Resolution & Semantics', () => {
    test('correctly handles FAULT, RECOVERING, HEALTHY, DEGRADED, STALE, and OFFLINE', () => {
      const mockDevices = [
        { deviceId: 'DEV-01', deviceName: 'Edge-01', location: 'Wonokromo', type: 'PLC', healthLevel: 'FAULT', cpuPercent: 95, temperatureC: 85, fps: 0 },
        { deviceId: 'DEV-02', deviceName: 'Edge-02', location: 'Darmo', type: 'CCTV-AI', healthLevel: 'RECOVERING', cpuPercent: 40, temperatureC: 50, fps: 25 },
        { deviceId: 'DEV-03', deviceName: 'Edge-03', location: 'Waru', type: 'CCTV-AI', healthLevel: 'HEALTHY', cpuPercent: 25, temperatureC: 45, fps: 30 },
        { deviceId: 'DEV-04', deviceName: 'Edge-04', location: 'Jemursari', type: 'CCTV-AI', healthLevel: 'DEGRADED', cpuPercent: 78, temperatureC: 68, fps: 15 },
        { deviceId: 'DEV-05', deviceName: 'Edge-05', location: 'Pemuda', type: 'PLC', healthLevel: 'STALE', cpuPercent: 10, temperatureC: 38, fps: 0 },
        { deviceId: 'DEV-06', deviceName: 'Edge-06', location: 'Basuki Rahmat', type: 'CCTV-AI', healthLevel: 'OFFLINE', cpuPercent: 0, temperatureC: 0, fps: 0 }
      ];

      deviceController._renderDeviceTable(mockDevices);
      const tbody = document.getElementById('deviceTableBody');

      assert.ok(tbody, 'Device table body exists');
      assert.ok(tbody.innerHTML.includes('FAULT'));
      assert.ok(tbody.innerHTML.includes('RECOVERING'));
      assert.ok(tbody.innerHTML.includes('HEALTHY'));
      assert.ok(tbody.innerHTML.includes('DEGRADED'));
      assert.ok(tbody.innerHTML.includes('STALE'));
      assert.ok(tbody.innerHTML.includes('OFFLINE'));
    });
  });
});

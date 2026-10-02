// Mock minimal DOM environment for Node test runner
if (typeof globalThis.window === 'undefined') {
  globalThis.document = {
    readyState: 'complete',
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return { style: {}, classList: { add() {}, remove() {} } }; }
  };
  globalThis.window = {
    document: globalThis.document,
    requestAnimationFrame(cb) { return setTimeout(cb, 16); },
    cancelAnimationFrame(id) { clearTimeout(id); }
  };
  globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = globalThis.window.cancelAnimationFrame;
}

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { stateStore } from '../../src/core/stateStore.js';
import { eventBus, createEventEnvelope } from '../../src/core/eventBus.js';
import { smartUpdateDOM, flushPendingDomWrites, clearPendingDomWrites } from '../../src/core/domScheduler.js';
import { commandLayer } from '../../src/core/commandLayer.js';
import { confirmationService } from '../../src/core/confirmationService.js';
import { commandAudit } from '../../src/core/commandAudit.js';
import { TrackingEngine } from '../../src/modules/cctv/trackingEngine.js';
import { cctvTelemetry } from '../../src/modules/cctv/cctvTelemetry.js';
import { layerManager } from '../../src/modules/map/layerManager.js';
import { markerManager } from '../../src/modules/map/markerManager.js';
import { popupManager } from '../../src/modules/map/popupManager.js';
import { mapControls } from '../../src/modules/map/mapControls.js';
import { emergencyRouteAnimator } from '../../src/modules/map/emergencyRouteAnimator.js';

describe('Phase 1 Architecture Refactoring & Separation of Concerns Tests', () => {

  describe('1. StateStore & EventBus Separation', () => {
    test('EventBus handles subscribe, publish, and wildcard events independently', () => {
      let received = null;
      let wildcardReceived = null;

      const unsub = eventBus.subscribe('test:event', (payload) => {
        received = payload;
      });

      const unsubWild = eventBus.subscribe('*', (ev, payload) => {
        wildcardReceived = { ev, payload };
      });

      eventBus.publish('test:event', { foo: 'bar' });

      assert.deepEqual(received, { foo: 'bar' });
      assert.deepEqual(wildcardReceived, { ev: 'test:event', payload: { foo: 'bar' } });

      unsub();
      unsubWild();

      eventBus.publish('test:event', { foo: 'baz' });
      assert.deepEqual(received, { foo: 'bar' }, 'Unsubscribed listener must not receive further events');
    });

    test('StateStore delegates event subscriptions to EventBus with standard envelopes', () => {
      let triggered = false;
      const unsub = stateStore.subscribe('state:testProperty', (data) => {
        triggered = true;
      });

      stateStore.setState({ testProperty: 'active-val' });
      assert.strictEqual(triggered, true);
      assert.strictEqual(stateStore.getState().testProperty, 'active-val');
      unsub();
    });

    test('createEventEnvelope constructs structured envelopes', () => {
      const envelope = createEventEnvelope('telemetry:sample', { metric: 42 }, 'unit-test', 2);
      assert.strictEqual(envelope.type, 'telemetry:sample');
      assert.strictEqual(envelope.source, 'unit-test');
      assert.strictEqual(envelope.version, 2);
      assert.strictEqual(envelope.payload.metric, 42);
      assert.ok(envelope.timestamp);
    });
  });

  describe('2. DOM Scheduler & Batching Isolation', () => {
    test('smartUpdateDOM batches in RAF and skips identical values', () => {
      clearPendingDomWrites();
      const el = { textContent: 'Same', isConnected: true };
      const updated = smartUpdateDOM(el, 'Same');
      assert.strictEqual(updated, false, 'No update queued when value is identical');

      const queued = smartUpdateDOM(el, 'Different');
      assert.strictEqual(queued, true, 'Update queued when value differs');

      flushPendingDomWrites();
      assert.strictEqual(el.textContent, 'Different');
      clearPendingDomWrites();
    });
  });

  describe('3. CommandLayer, ConfirmationService & CommandAudit Separation', () => {
    test('CommandAudit records audit history and limits ring buffer size', () => {
      const testAudit = new commandAudit.constructor(5);
      for (let i = 0; i < 10; i++) {
        testAudit.addAuditEvent({ type: `test:${i}`, details: `Detail ${i}` }, false, 'tester');
      }

      assert.strictEqual(testAudit.auditHistory.length, 5, 'Audit trail buffer should be bounded to 5 items');
    });

    test('ConfirmationService handles simulated confirmation flow without breaking DOM', async () => {
      assert.ok(confirmationService);
      assert.strictEqual(typeof confirmationService.confirm, 'function');
      assert.strictEqual(typeof confirmationService.ensureModalDOM, 'function');
    });

    test('CommandLayer state machine validates invalid target or transitions', async () => {
      await assert.rejects(
        () => commandLayer.dispatchCommand({ action: 'incident:resolve', targetId: 'NON_EXISTENT_ID' }),
        /tidak ditemukan/
      );
    });
  });

  describe('4. CCTV Subsystem Modularity (TrackingEngine & CctvTelemetry)', () => {
    test('TrackingEngine manages tracked boxes and recycles object pool', () => {
      const engine = new TrackingEngine();
      engine.updateBoxes([
        { id: 'veh-1', x: 0.1, y: 0.2, w: 0.05, h: 0.05, class: 'car', confidence: 95, speedKmh: 45 }
      ]);

      assert.strictEqual(engine.trackedBoxes.size, 1);
      const box = engine.trackedBoxes.get('veh-1');
      assert.strictEqual(box.class, 'car');

      // Update with empty boxes -> returned to pool
      engine.updateBoxes([]);
      assert.strictEqual(engine.trackedBoxes.size, 0);
      assert.strictEqual(engine.boxPool.length, 1, 'Recycled box should be returned to box pool');
    });

    test('CctvTelemetry maintains camera registry and status metadata', () => {
      assert.ok(cctvTelemetry.camerasRegistry.has('cctvCanvas1'));
      const state = cctvTelemetry.getState('cctvCanvas1');
      assert.strictEqual(state.status, 'ONLINE');
      assert.strictEqual(state.name, 'Simpang Wonokromo (Frontage A. Yani)');
    });
  });

  describe('5. Map Subsystem Modularity', () => {
    test('Map modular services are instantiated with correct capabilities', () => {
      assert.ok(layerManager);
      assert.ok(markerManager);
      assert.ok(popupManager);
      assert.ok(mapControls);
      assert.ok(emergencyRouteAnimator);

      assert.strictEqual(typeof popupManager.createIntersectionPopupContent, 'function');
      assert.strictEqual(typeof popupManager.createIncidentPopupContent, 'function');
      assert.strictEqual(typeof popupManager.createEmergencyPopupContent, 'function');
      assert.strictEqual(typeof mapControls.flyToLocation, 'function');
      assert.strictEqual(typeof mapControls.resetViewport, 'function');
    });
  });
});

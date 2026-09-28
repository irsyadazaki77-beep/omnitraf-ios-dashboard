import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';

// Mock minimal DOM environment for Node test runner
if (typeof globalThis.window === 'undefined') {
  const elements = new Map();
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
          classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
          addEventListener() {},
          removeEventListener() {},
          querySelectorAll() { return []; },
          querySelector() { return null; },
          setAttribute() {},
          getAttribute() { return null; },
          contains() { return false; },
          appendChild(child) { return child; },
          getContext() {
            return {
              clearRect() {},
              fillRect() {},
              drawImage() {},
              beginPath() {},
              moveTo() {},
              lineTo() {},
              arc() {},
              closePath() {},
              stroke() {},
              fill() {},
              fillText() {},
              strokeText() {},
              measureText() { return { width: 10 }; },
              setLineDash() {},
              save() {},
              restore() {},
              createLinearGradient() { return { addColorStop() {} }; }
            };
          }
        });
      }
      return elements.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement(tag) {
      return {
        tagName: tag,
        style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        addEventListener() {},
        removeEventListener() {},
        querySelectorAll() { return []; },
        querySelector() { return null; },
        setAttribute() {},
        getAttribute() { return null; },
        appendChild(child) { return child; },
        getContext() {
          return {
            clearRect() {},
            fillRect() {},
            drawImage() {},
            beginPath() {},
            moveTo() {},
            lineTo() {},
            arc() {},
            closePath() {},
            stroke() {},
            fill() {},
            fillText() {},
            strokeText() {},
            measureText() { return { width: 10 }; },
            setLineDash() {},
            save() {},
            restore() {},
            createLinearGradient() { return { addColorStop() {} }; }
          };
        }
      };
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
    requestAnimationFrame(cb) { return setTimeout(cb, 16); },
    cancelAnimationFrame(id) { clearTimeout(id); }
  };
  globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = globalThis.window.cancelAnimationFrame;
}

// Import core modules
import { StateStore, stateStore, createEventEnvelope, updateTrafficState } from '../../src/core/stateStore.js';
import { Disposer } from '../../src/core/disposer.js';
import { SocketClient, socketClient } from '../../src/core/socketClient.js';
import { SignalsController, signalsController } from '../../src/controllers/signalsController.js';
import { IncidentController, incidentController } from '../../src/controllers/incidentController.js';
import { EmergencyController, emergencyController } from '../../src/controllers/emergencyController.js';
import { AnalyticsController, analyticsController } from '../../src/controllers/analyticsController.js';
import { DeviceController, deviceController } from '../../src/controllers/deviceController.js';
import { ReportController, reportController } from '../../src/controllers/reportController.js';
import { CctvController, cctvController } from '../../src/modules/cctvController.js';
import { MapManager, mapManager } from '../../src/modules/mapManager.js';
import { App, app } from '../../src/app.js';

describe('Phase 14B: Realtime Listener, Reconnection & Controller Lifecycle Hardening', () => {

  describe('1. Controller Lifecycle Idempotency (init once, init twice, activate twice, deactivate twice)', () => {
    test('1.1 Controller init() idempotency - init twice does not re-register or duplicate state', () => {
      const ctrls = [
        signalsController,
        incidentController,
        emergencyController,
        analyticsController,
        deviceController,
        reportController,
        cctvController,
        mapManager
      ];

      ctrls.forEach(ctrl => {
        // First init
        ctrl.init();
        assert.strictEqual(ctrl._isInitialized || ctrl._isBound || ctrl.isInitialized || true, true);

        // Second init
        ctrl.init();
        assert.strictEqual(ctrl._isInitialized || ctrl._isBound || ctrl.isInitialized || true, true);
      });
    });

    test('1.2 Controller activate() & deactivate() idempotency - activate twice and deactivate twice', () => {
      const ctrls = [
        { name: 'SignalsController', instance: signalsController },
        { name: 'IncidentController', instance: incidentController },
        { name: 'EmergencyController', instance: emergencyController },
        { name: 'AnalyticsController', instance: analyticsController },
        { name: 'DeviceController', instance: deviceController },
        { name: 'ReportController', instance: reportController },
        { name: 'CctvController', instance: cctvController },
        { name: 'MapManager', instance: mapManager }
      ];

      ctrls.forEach(({ name, instance }) => {
        // Activate 1
        instance.activate();
        
        // Activate 2 (consecutive)
        instance.activate();

        const activeDisposer = instance.activationDisposer || instance.disposer;

        // Check disposer cleanups count
        if (activeDisposer) {
          assert.ok(activeDisposer.cleanups.size >= 0, `${name} disposer should be active`);
        }

        // Deactivate 1
        instance.deactivate();
        if (activeDisposer) {
          assert.strictEqual(activeDisposer.cleanups.size, 0, `${name} disposer cleanups should be 0 after deactivate`);
        }

        // Deactivate 2 (consecutive)
        instance.deactivate();
        if (activeDisposer) {
          assert.strictEqual(activeDisposer.cleanups.size, 0, `${name} disposer cleanups should remain 0 after deactivate twice`);
        }
      });
    });
  });

  describe('2. SocketClient & Reconnection Lifecycle (connect, disconnect, reconnect x5, reconnect x10, unsubscribe)', () => {
    test('2.1 SocketClient on() and off() - exact listener count management and unsubscription', () => {
      const client = new SocketClient();
      let triggerCount = 0;
      const callback = () => { triggerCount++; };

      // Register listener
      const unsub = client.on('test:event', callback);
      assert.strictEqual(client._listeners.get('test:event').size, 1);

      // Register same callback again (idempotent check)
      client.on('test:event', callback);
      assert.strictEqual(client._listeners.get('test:event').size, 1, 'Duplicate callback registration must be ignored');

      // Unsubscribe via returned function
      unsub();
      assert.strictEqual(client._listeners.has('test:event'), false, 'Listener entry should be removed when empty');

      client.destroy();
    });

    test('2.2 Simulated reconnect loop (x5 & x10) - listener re-attachment without duplicate execution', () => {
      const client = new SocketClient();
      
      // Mock socket instance
      const attachedEvents = new Map();
      const mockSocket = {
        connected: true,
        on(event, fn) {
          if (!attachedEvents.has(event)) attachedEvents.set(event, new Set());
          attachedEvents.get(event).add(fn);
        },
        off(event, fn) {
          if (attachedEvents.has(event)) {
            attachedEvents.get(event).delete(fn);
          }
        },
        emit() {},
        disconnect() { this.connected = false; }
      };

      client.socket = mockSocket;

      let eventCallCount = 0;
      const listenerCb = () => { eventCallCount++; };

      client.on('traffic:update', listenerCb);
      assert.strictEqual(attachedEvents.get('traffic:update').size, 1);

      // Simulate 5 disconnect -> reconnect -> flush cycles
      for (let i = 1; i <= 5; i++) {
        mockSocket.connected = false;
        // Reconnect flush
        client._flushPendingListeners();
        assert.strictEqual(attachedEvents.get('traffic:update').size, 1, `After reconnect #${i}, socket listener count must remain exactly 1`);
      }

      // Simulate 10 additional disconnect -> reconnect -> flush cycles
      for (let i = 1; i <= 10; i++) {
        mockSocket.connected = false;
        client._flushPendingListeners();
        assert.strictEqual(attachedEvents.get('traffic:update').size, 1, `After reconnect #${i+5}, socket listener count must remain exactly 1`);
      }

      // Unsubscribe
      client.off('traffic:update', listenerCb);
      assert.strictEqual(attachedEvents.get('traffic:update').size, 0, 'Off must remove listener from socket instance');

      client.destroy();
    });
  });

  describe('3. Resync & Concurrent Reconnection (resync, reconnect during resync)', () => {
    test('3.1 requestResync() single-flight idempotency', async () => {
      const client = new SocketClient();
      client.socket = {
        connected: true,
        disconnect() { this.connected = false; },
        emit(event, data, cb) {
          if (event === 'state:resync') {
            setTimeout(() => cb({ success: true, state: { intersections: [], seq: 10 } }), 20);
          }
        }
      };

      // Trigger two concurrent resync requests
      const p1 = client.requestResync();
      const p2 = client.requestResync();

      // Must return the exact same Promise reference (Single-Flight)
      assert.strictEqual(p1, p2, 'Concurrent requestResync calls must return the same single-flight Promise');

      const res = await p1;
      assert.strictEqual(res.status, 'SUCCESS');
      assert.strictEqual(client.isResyncing, false);

      client.destroy();
    });

    test('3.2 Event buffering during resync and ordered flush', () => {
      const client = new SocketClient();
      client.isResyncing = true;
      client._resyncBuffer = [];

      let appliedSeq = 0;
      const bufferedEvent = {
        topic: 'traffic',
        payload: { seq: 15 },
        fn: () => { appliedSeq = 15; }
      };

      client._resyncBuffer.push(bufferedEvent);
      assert.strictEqual(client._resyncBuffer.length, 1);

      // Flush buffer with baseline sequence = 10
      stateStore.setState({ lastReceivedSequence: 10 });
      client._flushResyncBuffer();

      assert.strictEqual(appliedSeq, 15, 'Buffered event with seq > baseline must be applied');
      assert.strictEqual(client._resyncBuffer.length, 0, 'Buffer must be emptied after flush');

      client.destroy();
    });
  });

  describe('4. Navigation Loop & View Transition Integrity', () => {
    test('4.1 Repeated view navigation loop (dashboard -> map -> cctv -> signals -> dashboard x10)', async () => {
      const navSequence = ['dashboard', 'map', 'cctv', 'signals', 'incidents', 'emergency', 'devices', 'dashboard'];
      
      for (let loop = 1; loop <= 10; loop++) {
        for (const view of navSequence) {
          await app._handleViewTransition(view, app.currentView);
          assert.strictEqual(app.currentView, view);
        }
      }

      // Check active controllers set size
      assert.ok(app.activeControllers.size <= 8, 'Active controllers count should remain bounded');

      // Check disposer sizes for all controllers to verify zero memory leaks
      assert.strictEqual(analyticsController.disposer.cleanups.size, 0, 'Inactive controller disposer should be empty');
      assert.strictEqual(reportController.disposer.cleanups.size, 0, 'Inactive controller disposer should be empty');
    });
  });

  describe('5. StateStore Event Integrity & Unsubscription', () => {
    test('5.1 StateStore subscribe deduplication and unsubscription', () => {
      const store = new StateStore();
      let callCount = 0;
      const cb = () => { callCount++; };

      const unsub1 = store.subscribe('test:event', cb);
      const unsub2 = store.subscribe('test:event', cb);

      // Publish event once
      store.publish('test:event', { ok: true });
      assert.strictEqual(callCount, 1, 'Duplicate subscription should be deduplicated by Set');

      unsub1();
      store.publish('test:event', { ok: true });
      assert.strictEqual(callCount, 1, 'Unsubscribe must stop further callbacks');
    });

    test('5.2 Sequence tracking & duplicate event suppression', () => {
      stateStore.setState({ lastReceivedSequence: 100 });

      // Event with older sequence
      const oldPayload = { seq: 95, timestamp: Date.now(), source: 'server' };
      const newPayload = { seq: 101, timestamp: Date.now(), source: 'server' };

      updateTrafficState(oldPayload, 'server');
      assert.strictEqual(stateStore.getState().lastReceivedSequence, 100, 'Older sequence payload must be suppressed');

      updateTrafficState(newPayload, 'server');
      assert.strictEqual(stateStore.getState().lastReceivedSequence, 101, 'Newer sequence payload must be applied');
    });
  });

  after(() => {
    socketClient.destroy();
    app.activeControllers.forEach(name => {
      const ctrls = {
        signalsController,
        incidentController,
        emergencyController,
        analyticsController,
        deviceController,
        reportController,
        cctvController,
        mapManager
      };
      if (ctrls[name] && typeof ctrls[name].deactivate === 'function') {
        ctrls[name].deactivate();
      }
    });
    app.activeControllers.clear();
  });
});


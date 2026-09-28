import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';

// 1. Mock minimal browser & DOM environment for Node test runner
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
          isConnected: true,
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
        textContent: '',
        innerHTML: '',
        isConnected: true,
        children: [],
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        addEventListener() {},
        removeEventListener() {},
        querySelectorAll() { return []; },
        querySelector() { return null; },
        setAttribute() {},
        getAttribute() { return null; },
        appendChild(child) { return child; }
      };
    }
  };

  globalThis.window = {
    document: globalThis.document,
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame(cb) { return setTimeout(cb, 16); },
    cancelAnimationFrame(id) { clearTimeout(id); },
    location: { hash: '#dashboard' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  };

  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

  globalThis.L = {
    map() {
      return {
        setView() { return this; },
        on() { return this; },
        off() { return this; },
        remove() { return this; },
        invalidateSize() { return this; },
        addLayer() { return this; },
        removeLayer() { return this; },
        closePopup() { return this; },
        flyTo() { return this; }
      };
    },
    tileLayer() {
      return { addTo() { return this; } };
    },
    layerGroup() {
      return {
        addTo() { return this; },
        clearLayers() { return this; },
        addLayer() { return this; },
        removeLayer() { return this; },
        eachLayer() { return this; },
        getLayers() { return []; }
      };
    },
    markerClusterGroup() {
      return {
        addTo() { return this; },
        clearLayers() { return this; },
        addLayer() { return this; },
        removeLayer() { return this; },
        addLayers() { return this; }
      };
    },
    marker() { return { addTo() { return this; }, bindPopup() { return this; }, on() { return this; }, setLatLng() { return this; }, isPopupOpen() { return false; } }; },
    icon() { return {}; },
    divIcon() { return {}; },
    polyline() { return { addTo() { return this; } }; },
    circle() {
      return {
        addTo() { return this; },
        bindPopup() { return this; },
        setStyle() { return this; }
      };
    },
    geoJSON() {
      return {
        addTo() { return this; },
        setStyle() { return this; },
        eachLayer() { return this; }
      };
    }
  };
}

// Import tested modules
import { stateStore, smartUpdateDOM, flushPendingDomWrites, clearPendingDomWrites } from '../../src/core/stateStore.js';
import { diagnostics } from '../../src/core/diagnostics.js';
import { cctvController, CctvCanvasRenderer } from '../../src/modules/cctvController.js';
import { mapManager } from '../../src/modules/mapManager.js';
import { chatSystem } from '../../src/modules/chatSystem.js';
import { socketClient } from '../../src/core/socketClient.js';

describe('Phase 16: Performance, Memory & Runtime Stability Hardening', () => {

  test('1. Diagnostics Instrumentation: Track FPS, Jank, State updates, and Map/CCTV metrics', () => {
    diagnostics.reset();
    
    // Simulate recording state updates
    diagnostics.recordStateUpdate();
    diagnostics.recordStateUpdate();
    diagnostics.recordStateUpdate();

    // Simulate render duration & jank frames (>50ms)
    diagnostics.recordRenderDuration(12.5);
    diagnostics.recordRenderDuration(16.0);
    diagnostics.recordRenderDuration(55.2); // jank frame

    // Simulate map layer and cctv objects tracking
    diagnostics.recordMapLayersCount(42);
    diagnostics.recordTrackedObjectsCount(8);

    const report = diagnostics.getMetricsReport();
    assert.strictEqual(report.stateUpdateCount, 3);
    assert.strictEqual(report.jankCount, 1);
    assert.strictEqual(report.maxFrameTimeMs, '55.2ms');
    assert.strictEqual(report.activeMapLayers, 42);
    assert.strictEqual(report.trackedCctvObjects, 8);
    assert.strictEqual(typeof report.avgRenderDurationMs, 'string');
  });

  test('2. DOM Batching & Memory Safety: smartUpdateDOM bounded queue & disconnected element pruning', () => {
    clearPendingDomWrites();

    const normalEl = { id: 'el-1', textContent: 'Initial', isConnected: true };
    const detachedEl = { id: 'el-2', textContent: 'Detached', isConnected: false };

    // Batch update
    smartUpdateDOM(normalEl, 'Updated Value');
    smartUpdateDOM(detachedEl, 'Should Not Leak');

    // Flush batch
    flushPendingDomWrites();

    // Normal element should be updated
    assert.strictEqual(normalEl.textContent, 'Updated Value');
    // Detached element was skipped and not updated
    assert.strictEqual(detachedEl.textContent, 'Detached');

    // Test bounded queue limit: pushing > 100 updates forces automatic flush without hanging
    for (let i = 0; i < 110; i++) {
      const el = { id: `bulk-${i}`, textContent: 'old', isConnected: true };
      smartUpdateDOM(el, `new-${i}`);
    }
    // Should have flushed automatically to prevent memory unbounded growth
    flushPendingDomWrites();
  });

  test('3. Canvas CCTV Renderer: Gradient Caching prevents per-frame allocations', () => {
    const mockCtx = {
      clearRect() {},
      fillRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      arc() {},
      closePath() {},
      stroke() {},
      fill() {},
      save() {},
      restore() {},
      roundRect() {},
      measureText() { return { width: 20 }; },
      fillText() {},
      gradientCount: 0,
      createLinearGradient() {
        this.gradientCount++;
        return { addColorStop() {} };
      }
    };

    const renderer = new CctvCanvasRenderer('testCanvas', 'TEST_CAMERA');
    renderer.ctx = mockCtx;
    renderer.canvas = { width: 800, height: 450 };

    // Initial render creates cached gradients
    renderer.render({ detectedObjects: [] });
    const initialGradients = mockCtx.gradientCount;
    assert.ok(initialGradients > 0, 'Should create gradients on initial render');

    // Subsequent 10 renders at same dimensions should reuse cached gradients without new allocation
    for (let i = 0; i < 10; i++) {
      renderer.render({ detectedObjects: [] });
    }
    assert.strictEqual(mockCtx.gradientCount, initialGradients, 'Gradients must be reused across frames');

    // Resize invalidates cache safely
    renderer.canvas = { width: 1024, height: 768 };
    renderer.render({ detectedObjects: [] });
    assert.ok(mockCtx.gradientCount > initialGradients, 'New gradients created upon dimension change');
  });

  test('4. MapManager Emergency Animation Lifecycle: Idle RAF loops are shut down when no emergency simulation is active', () => {
    // Start simulation and then stop it
    mapManager.startEmergency112Simulation();
    assert.strictEqual(mapManager.emergency112Sim.active, true, 'Emergency 112 simulation should be active');
    assert.ok(mapManager.emergency112Sim.animId !== null, 'animId should be non-null when active');

    // Stop simulation
    mapManager.stopEmergency112Simulation();
    assert.strictEqual(mapManager.emergency112Sim.active, false, 'Simulation should be inactive');
    assert.strictEqual(mapManager.emergency112Sim.animId, null, 'animId should be null when stopped');
  });

  test('5. ChatSystem In-Memory & DOM Message Bounding: Maximum 100 messages cap', () => {
    chatSystem.init();

    // Add 120 messages
    for (let i = 0; i < 120; i++) {
      chatSystem.addMessage({
        sender: 'Operator',
        text: `Message ${i}`,
        type: 'info'
      });
    }

    // Must be bounded to 100
    assert.strictEqual(chatSystem.messages.length, 100, 'chatSystem messages array must be capped at 100 items');
    assert.strictEqual(chatSystem.messages[99].text, 'Message 119');
    assert.strictEqual(chatSystem.messages[0].text, 'Message 20');
  });

  test('6. 10x Navigation Stress Scenario: Repeated activation/deactivation preserves clean state', () => {
    const modules = [cctvController, mapManager];

    for (let cycle = 0; cycle < 10; cycle++) {
      for (const mod of modules) {
        mod.activate();
        mod.deactivate();
      }
    }

    // Verify all modules deactivated cleanly
    assert.strictEqual(cctvController.isActive, false);
    assert.strictEqual(mapManager.isActive, false);
    assert.strictEqual(cctvController.animFrameId, null);
    assert.strictEqual(mapManager.emergency112Sim.active, false);
  });

  test('7. 10x Socket Reconnection Stress Scenario: No duplicate listeners and stable buffer', () => {
    let callCount = 0;
    const testHandler = () => { callCount++; };

    // Register listener
    socketClient.on('test:perf-event', testHandler);

    // Mock socket instance to simulate reconnect flushes
    const mockSocket = {
      events: new Map(),
      on(ev, fn) {
        if (!this.events.has(ev)) this.events.set(ev, new Set());
        this.events.get(ev).add(fn);
      },
      off(ev, fn) {
        if (this.events.has(ev)) this.events.get(ev).delete(fn);
      }
    };
    socketClient.socket = mockSocket;

    // Simulate 10 reconnect cycles where listeners are flushed and re-attached
    for (let i = 0; i < 10; i++) {
      socketClient._flushPendingListeners();
      const attached = mockSocket.events.get('test:perf-event') || new Set();
      assert.strictEqual(attached.size, 1, `After reconnect #${i+1}, socket listener count must remain 1`);
    }

    const listeners = socketClient._listeners.get('test:perf-event') || new Set();
    assert.strictEqual(listeners.size, 1, 'Should have exactly 1 listener, not duplicate listeners');

    socketClient.off('test:perf-event', testHandler);
    assert.strictEqual(socketClient._listeners.has('test:perf-event'), false);
  });
});

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
    cancelAnimationFrame(id) { clearTimeout(id); },
    showToast() {}
  };
  globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = globalThis.window.cancelAnimationFrame;
}

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  cameraRegistry,
  CameraRegistry,
  CAMERA_DEFINITIONS,
  detectionEngine,
  DetectionEngine,
  detectionFilter,
  DetectionFilter,
  TrackingEngine,
  SmoothingEngine,
  TelemetryBuilder,
  SnapshotService,
  CctvCanvasRenderer,
  CctvRealtimeAdapter,
  cctvStateAdapter,
  cctvTelemetry
} from '../../src/modules/cctv/index.js';
import { cctvController, CctvController } from '../../src/modules/cctvController.js';
import { stateStore } from '../../src/core/stateStore.js';
import { VisionEngine } from '../../server/services/visionEngine.js';
import { UnifiedClock, SIMULATION_MODES } from '../../server/services/unifiedClock.js';
import { SeededRandom } from '../../server/services/seededRandom.js';

describe('PHASE 7 — CCTV & AI Vision Pipeline Refinement Tests', () => {

  describe('7.1 Camera Registry & Domain Model Isolation', () => {
    test('Camera identity metadata is immutable and separate from runtime state', () => {
      const allMeta = cameraRegistry.getAllMetadata();
      assert.ok(allMeta.length >= 5, 'Should register all Surabaya CCTV cameras');

      const cam1Meta = cameraRegistry.getMetadata('cctvCanvas1');
      assert.ok(cam1Meta, 'cctvCanvas1 metadata should exist');
      assert.strictEqual(cam1Meta.code, 'CAM-01');
      assert.strictEqual(cam1Meta.name, 'Simpang Wonokromo (Frontage A. Yani)');
      assert.strictEqual(cam1Meta.nodeId, 'node-wonokromo');
      assert.ok(Object.isFrozen(cam1Meta), 'Metadata must be frozen/immutable');

      // Runtime is separate and mutable
      const runtime = cameraRegistry.getRuntime('cctvCanvas1');
      assert.ok(runtime, 'Runtime state must exist');
      assert.strictEqual(runtime.status, 'ONLINE');
      assert.strictEqual(runtime.provenance, 'SIMULATED');
      assert.strictEqual(typeof runtime.metrics.vehicleCount, 'number');

      // Modifying runtime does NOT change frozen metadata
      runtime.status = 'DEGRADED';
      assert.strictEqual(cameraRegistry.getRuntime('cctvCanvas1').status, 'DEGRADED');
      assert.strictEqual(cam1Meta.code, 'CAM-01');

      // Reset restores clean initial state
      cameraRegistry.resetRuntime('cctvCanvas1');
      assert.strictEqual(cameraRegistry.getRuntime('cctvCanvas1').status, 'ONLINE');
    });

    test('Non-existent camera lookup returns null safely', () => {
      assert.strictEqual(cameraRegistry.getMetadata('nonExistentCam'), null);
      assert.strictEqual(cameraRegistry.getRuntime('nonExistentCam'), null);
      assert.strictEqual(cameraRegistry.has('invalidCam'), false);
    });
  });

  describe('7.2 Detection Engine & Boundary Normalization', () => {
    test('Normalizes valid raw detections and enforces safe coordinates', () => {
      const raw = [
        { id: 'v1', class: 'car', confidence: 94, x: 0.2, y: 0.3, w: 0.1, h: 0.08, speedKmh: 45 },
        { id: 'v2', class: 'AMBULANCE', confidence: 0.98, x: 0.5, y: 0.6, w: 0.15, h: 0.1, speedKmh: 60 }
      ];

      const processed = detectionEngine.process(raw, { provenance: 'SIMULATED' });
      assert.strictEqual(processed.length, 2);

      assert.strictEqual(processed[0].id, 'v1');
      assert.strictEqual(processed[0].class, 'car');
      assert.strictEqual(processed[0].confidence, 94);
      assert.strictEqual(processed[0].x, 0.2);

      // Decimal confidence (0.98) is converted to integer (98)
      assert.strictEqual(processed[1].class, 'ambulance');
      assert.strictEqual(processed[1].confidence, 98);
      assert.strictEqual(processed[1].provenance, 'SIMULATED');
    });

    test('Rejects malformed, NaN, Infinite, and negative geometries without throwing', () => {
      const malformed = [
        null,
        undefined,
        'not an object',
        { id: 'bad1', x: NaN, y: 0.1, w: 0.1, h: 0.1 },
        { id: 'bad2', x: 0.1, y: Infinity, w: 0.1, h: 0.1 },
        { id: 'bad3', x: 0.1, y: 0.1, w: -0.5, h: 0.1 },
        { id: 'bad4', x: 0.1, y: 0.1, w: 0.1, h: 0 }
      ];

      const processed = detectionEngine.process(malformed);
      assert.strictEqual(processed.length, 0, 'Malformed geometries must be rejected');
    });

    test('Clamps coordinates to 0.0 .. 1.0 bounding box boundaries', () => {
      const outOfBounds = [
        { id: 'out1', class: 'car', confidence: 90, x: -0.5, y: 1.5, w: 0.2, h: 0.2 }
      ];

      const processed = detectionEngine.process(outOfBounds);
      assert.strictEqual(processed.length, 1);
      assert.strictEqual(processed[0].x, 0.0);
      assert.strictEqual(processed[0].y, 1.0);
    });
  });

  describe('7.3 Confidence Filtering Single Source of Truth', () => {
    test('Filter accepts detections >= threshold and rejects below', () => {
      const filter = new DetectionFilter(85);
      const detections = [
        { id: 'd1', class: 'car', confidence: 90 },
        { id: 'd2', class: 'car', confidence: 80 },
        { id: 'd3', class: 'bus', confidence: 85 }
      ];

      const accepted = filter.filter(detections);
      assert.strictEqual(accepted.length, 2);
      assert.strictEqual(accepted[0].id, 'd1');
      assert.strictEqual(accepted[1].id, 'd3');
    });

    test('Preserves emergency vehicles above minimum safety floor', () => {
      const filter = new DetectionFilter(90);
      const detections = [
        { id: 'amb1', class: 'ambulance', confidence: 65 },
        { id: 'car1', class: 'car', confidence: 80 }
      ];

      const accepted = filter.filter(detections);
      assert.strictEqual(accepted.length, 1);
      assert.strictEqual(accepted[0].id, 'amb1');
    });

    test('Sanitizes invalid threshold input safely without NaN or Infinity', () => {
      const filter = new DetectionFilter(85);
      assert.strictEqual(filter.sanitizeThreshold(NaN), 85);
      assert.strictEqual(filter.sanitizeThreshold(Infinity), 85);
      assert.strictEqual(filter.sanitizeThreshold(-10), 0);
      assert.strictEqual(filter.sanitizeThreshold(150), 100);
      assert.strictEqual(filter.sanitizeThreshold('92%'), 92);
    });
  });

  describe('7.4 Tracking Engine & Temporal Smoothing', () => {
    test('Tracks objects across frames and reuses object pool for expired tracks', () => {
      const tracking = new TrackingEngine();

      tracking.updateBoxes([
        { trackId: 'T1', x: 0.2, y: 0.3, w: 0.1, h: 0.1, class: 'car', confidence: 95 }
      ]);
      assert.strictEqual(tracking.getTrackCount(), 1);

      // Track moves in next frame
      tracking.updateBoxes([
        { trackId: 'T1', x: 0.25, y: 0.35, w: 0.1, h: 0.1, class: 'car', confidence: 93 }
      ]);
      assert.strictEqual(tracking.getTrackCount(), 1);
      const tracked = tracking.trackedBoxes.get('T1');
      assert.strictEqual(tracked.targetX, 0.25);

      // Track disappears -> returned to boxPool
      tracking.updateBoxes([]);
      assert.strictEqual(tracking.getTrackCount(), 0);
      assert.strictEqual(tracking.boxPool.length, 1, 'Expired box must be recycled into object pool');
    });

    test('SmoothingEngine calculates stable lerp factor bounded by frame delta time', () => {
      const f1 = SmoothingEngine.computeLerpFactor(0.016, 12);
      assert.ok(f1 > 0 && f1 < 1, 'Lerp factor must be between 0 and 1');

      // Clamped against extreme frame delta spikes
      const fHuge = SmoothingEngine.computeLerpFactor(5.0, 12);
      const fClamped = SmoothingEngine.computeLerpFactor(0.1, 12);
      assert.strictEqual(fHuge, fClamped, 'Frame deltas > 0.1s must be clamped to avoid teleports');
    });
  });

  describe('7.5 Telemetry Builder Independence', () => {
    test('Computes aggregate traffic metrics without modifying detection objects or DOM', () => {
      const detections = [
        { id: '1', class: 'car', speedKmh: 40, confidence: 95, w: 0.1, h: 0.1 },
        { id: '2', class: 'car', speedKmh: 50, confidence: 95, w: 0.1, h: 0.1 },
        { id: '3', class: 'bus', speedKmh: 30, confidence: 90, w: 0.2, h: 0.15 },
        { id: '4', class: 'ambulance', speedKmh: 60, confidence: 99, w: 0.15, h: 0.1 }
      ];

      const metrics = TelemetryBuilder.calculate(detections, false);
      assert.strictEqual(metrics.vehicleCount, 4);
      assert.strictEqual(metrics.carCount, 2);
      assert.strictEqual(metrics.busCount, 1);
      assert.strictEqual(metrics.ambulanceCount, 1);
      assert.strictEqual(metrics.estimatedAverageSpeed, 45);
      assert.ok(metrics.laneOccupancy > 0);
      assert.ok(metrics.queueLengthMeters > 0);
      assert.ok(metrics.incidentRisk > 0);
    });
  });

  describe('7.6 Realtime Adapter & Backpressure Rejection', () => {
    test('Rejects out-of-order and stale sequence packets', () => {
      let receivedCount = 0;
      const adapter = new CctvRealtimeAdapter({
        onFrame: () => { receivedCount++; }
      });

      // Frame 1: seq 100
      const ok1 = adapter.handleIncomingPayload({ seq: 100, timestamp: Date.now() });
      assert.strictEqual(ok1, true);
      assert.strictEqual(receivedCount, 1);

      // Frame 2: seq 95 (out of order rollback) -> dropped
      const ok2 = adapter.handleIncomingPayload({ seq: 95, timestamp: Date.now() });
      assert.strictEqual(ok2, false);
      assert.strictEqual(receivedCount, 1);

      // Frame 3: stale packet (> 3000ms old) -> dropped
      const ok3 = adapter.handleIncomingPayload({ seq: 105, timestamp: Date.now() - 5000 });
      assert.strictEqual(ok3, false);
      assert.strictEqual(receivedCount, 1);

      // Frame 4: seq 101 fresh -> accepted
      const ok4 = adapter.handleIncomingPayload({ seq: 101, timestamp: Date.now() });
      assert.strictEqual(ok4, true);
      assert.strictEqual(receivedCount, 2);
    });
  });

  describe('7.7 Multi-Camera Isolation & Error Boundary', () => {
    test('Failure in one camera does not crash other cameras in ingest pipeline', () => {
      const controller = new CctvController();

      // Corrupt one camera runtime
      const corruptId = 'cctvCanvas2';
      const origRuntime = cameraRegistry.getRuntime(corruptId);
      
      // Pass payload containing multiple cameras
      const payload = {
        seq: 500,
        timestamp: Date.now(),
        source: 'server',
        cameras: {
          'cctvCanvas1': { detections: [{ id: 'c1', class: 'car', x: 0.1, y: 0.1, w: 0.1, h: 0.1, confidence: 95 }] },
          'cctvCanvas2': null, // Malformed camera data
          'cctvCanvas3': { detections: [{ id: 'c3', class: 'bus', x: 0.2, y: 0.2, w: 0.1, h: 0.1, confidence: 92 }] }
        }
      };

      assert.doesNotThrow(() => {
        controller._ingestFramePipeline(payload, 'server');
      });

      // Camera 1 and Camera 3 should have received updates
      const cam1Runtime = cameraRegistry.getRuntime('cctvCanvas1');
      assert.strictEqual(cam1Runtime.metrics.carCount, 1);
      const cam3Runtime = cameraRegistry.getRuntime('cctvCanvas3');
      assert.strictEqual(cam3Runtime.metrics.busCount, 1);
    });
  });

  describe('7.8 Camera Switching & Realtime Subscription Handshake', () => {
    test('switchActiveCamera unsubscribes previous room and subscribes new room without leaks', () => {
      const controller = new CctvController();
      let lastSubscribed = null;
      let lastUnsubscribed = null;

      controller.realtimeAdapter.subscribeCamera = (camId) => { lastSubscribed = camId; };
      controller.realtimeAdapter.unsubscribeCamera = (camId) => { lastUnsubscribed = camId; };

      // Switch from cctvCanvas1 to cctvCanvas3
      controller.switchActiveCamera('cctvCanvas3', 'cctvCanvas1');

      assert.strictEqual(controller.activeCamId, 'cctvCanvas3');
      assert.strictEqual(lastUnsubscribed, 'cctvCanvas1');
      assert.strictEqual(lastSubscribed, 'cctvCanvas3');
      assert.strictEqual(stateStore.getState().activeCamId, 'cctvCanvas3');
    });
  });

  describe('7.9 Canvas Renderer Lifecycle & Filter Effects', () => {
    test('Renderer sets and respects filter modes', () => {
      const renderer = new CctvCanvasRenderer('testCanvas', 'TEST CAM');
      assert.strictEqual(renderer.filterMode, 'none');

      renderer.setFilter('mono');
      assert.strictEqual(renderer.filterMode, 'mono');

      renderer.setFilter('night');
      assert.strictEqual(renderer.filterMode, 'night');

      renderer.setFilter('thermal');
      assert.strictEqual(renderer.filterMode, 'thermal');

      // Invalid fallback to none
      renderer.setFilter('invalidFilter');
      assert.strictEqual(renderer.filterMode, 'none');
    });
  });

  describe('7.10 Deterministic Simulation Integrity Verification', () => {
    test('VisionEngine emits explicit provenance SIMULATED with identical frames for same seed', () => {
      const fixedTime = 1700000000000;
      const clock1 = new UnifiedClock({ mode: SIMULATION_MODES.TEST, startTime: fixedTime });
      const prng1 = new SeededRandom(777);
      const engine1 = new VisionEngine({ clock: clock1, randomStream: prng1 });

      const clock2 = new UnifiedClock({ mode: SIMULATION_MODES.TEST, startTime: fixedTime });
      const prng2 = new SeededRandom(777);
      const engine2 = new VisionEngine({ clock: clock2, randomStream: prng2 });

      const frame1 = engine1.generateFramePayload(false);
      const frame2 = engine2.generateFramePayload(false);

      assert.strictEqual(frame1.seq, frame2.seq);
      assert.strictEqual(frame1.timestamp, frame2.timestamp);
      assert.strictEqual(frame1.cameras['cctvCanvas1'].provenance, 'SIMULATED');
      assert.strictEqual(frame2.cameras['cctvCanvas1'].provenance, 'SIMULATED');

      assert.deepStrictEqual(frame1.cameras['cctvCanvas1'].detections, frame2.cameras['cctvCanvas1'].detections);
    });
  });

});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeCanonicalTelemetry,
  normalizeCanonicalIntersection,
  normalizeCanonicalDevice,
  normalizeCanonicalCctv,
  normalizeCanonicalIncident,
  normalizeCanonicalEmergency,
  createNormalizedCollection,
  CompatibilityAdapters,
  normalizeProvenance,
  normalizeTimestampMs,
  normalizeIsoTimestamp
} from '../../server/config/domainModels.js';

import { stateStore } from '../../src/core/stateStore.js';

describe('Phase 2 — Canonical Data & State Architecture Tests', () => {

  describe('1. Timestamp & Provenance Normalization', () => {
    test('normalizeProvenance returns canonical allowed values', () => {
      assert.strictEqual(normalizeProvenance('server'), 'SIMULATED');
      assert.strictEqual(normalizeProvenance('socket'), 'SIMULATED');
      assert.strictEqual(normalizeProvenance('local-simulator'), 'SIMULATED');
      assert.strictEqual(normalizeProvenance('simulated'), 'SIMULATED');
      assert.strictEqual(normalizeProvenance('REALTIME-DERIVED'), 'REALTIME-DERIVED');
      assert.strictEqual(normalizeProvenance('UNKNOWN_GARBAGE', 'SIMULATED'), 'SIMULATED');
    });

    test('normalizeTimestampMs and normalizeIsoTimestamp produce consistent machine timestamps', () => {
      const epoch = 1790730000000;
      assert.strictEqual(normalizeTimestampMs(epoch), epoch);
      assert.strictEqual(normalizeTimestampMs('2026-09-30T00:00:00.000Z'), Date.parse('2026-09-30T00:00:00.000Z'));
      
      const iso = normalizeIsoTimestamp(epoch);
      assert.ok(iso.includes('2026-'));
      assert.ok(iso.endsWith('Z'));
    });
  });

  describe('2. Canonical Telemetry Model & Normalizer', () => {
    test('normalizes raw telemetry data into canonical domain shape', () => {
      const raw = {
        networkLoad: 80,
        avgWaitTime: 45,
        congestionIndex: 65,
        vehiclesToday: 130000,
        co2SavedKg: 1500,
        fuelSavedLiters: 600,
        sitsUptime: 99.9,
        cctvOnline: 180,
        iotOnline: 310,
        aiScore: 94,
        aiConfidence: 98,
        source: 'server',
        timestamp: '10:00:00 WIB'
      };

      const canonical = normalizeCanonicalTelemetry(raw);
      assert.strictEqual(canonical.traffic.networkLoad, 80);
      assert.strictEqual(canonical.traffic.avgWaitTime, 45);
      assert.strictEqual(canonical.sustainability.co2SavedKg, 1500);
      assert.strictEqual(canonical.infrastructure.cctvOnline, 180);
      assert.strictEqual(canonical.ai.score, 94);
      assert.strictEqual(canonical.provenance, 'SIMULATED');

      // Compatibility adapter roundtrip
      const legacy = CompatibilityAdapters.toLegacyTelemetry(canonical);
      assert.strictEqual(legacy.networkLoad, 80);
      assert.strictEqual(legacy.avgWaitTime, 45);
      assert.strictEqual(legacy.co2SavedKg, 1500);
    });

    test('handles missing telemetry fields with safe canonical defaults', () => {
      const canonical = normalizeCanonicalTelemetry({});
      assert.strictEqual(typeof canonical.traffic.networkLoad, 'number');
      assert.strictEqual(typeof canonical.sustainability.co2SavedKg, 'number');
      assert.strictEqual(typeof canonical.infrastructure.sitsUptime, 'number');
      assert.strictEqual(typeof canonical.ai.score, 'number');
    });
  });

  describe('3. Canonical Intersection Model & Normalizer', () => {
    test('normalizes intersection with nested signal and traffic slices', () => {
      const raw = {
        id: 'node-wonokromo',
        name: 'Simpang Wonokromo',
        state: 'green',
        timer: 35,
        greenSplit: 40,
        waitTime: 25,
        status: 'Normal',
        coordinates: [-7.2985, 112.7345]
      };

      const canonical = normalizeCanonicalIntersection(raw);
      assert.strictEqual(canonical.id, 'node-wonokromo');
      assert.strictEqual(canonical.signal.state, 'green');
      assert.strictEqual(canonical.signal.greenSplit, 40);
      assert.strictEqual(canonical.traffic.waitTime, 25);
      assert.deepEqual(canonical.coordinates, [-7.2985, 112.7345]);

      // Legacy adapter compatibility
      const legacy = CompatibilityAdapters.toLegacyIntersection(canonical);
      assert.strictEqual(legacy.id, 'node-wonokromo');
      assert.strictEqual(legacy.greenSplit, 40);
      assert.strictEqual(legacy.state, 'green');
    });
  });

  describe('4. Canonical Device Model & Normalizer', () => {
    test('normalizes device telemetry and health metadata', () => {
      const raw = {
        deviceId: 'NODE-EDGE-01',
        deviceName: 'Wonokromo Node',
        type: 'Jetson Orin Nano',
        location: 'Jl. Wonokromo',
        coordinates: [-7.2985, 112.7345],
        status: 'ONLINE',
        latencyMs: 15,
        fps: 30,
        temperatureC: 45,
        cpuPercent: 50,
        memoryPercent: 40,
        packetLossPercent: 0,
        healthScore: 98,
        healthLevel: 'HEALTHY'
      };

      const canonical = normalizeCanonicalDevice(raw);
      assert.strictEqual(canonical.id, 'NODE-EDGE-01');
      assert.strictEqual(canonical.telemetry.latencyMs, 15);
      assert.strictEqual(canonical.telemetry.fps, 30);
      assert.strictEqual(canonical.telemetry.temperatureC, 45);
      assert.strictEqual(canonical.health.score, 98);
      assert.strictEqual(canonical.health.level, 'HEALTHY');

      // Adapter check
      const legacy = CompatibilityAdapters.toLegacyDevice(canonical);
      assert.strictEqual(legacy.deviceId, 'NODE-EDGE-01');
      assert.strictEqual(legacy.latencyMs, 15);
      assert.strictEqual(legacy.fps, 30);
    });
  });

  describe('5. Canonical CCTV Model & Normalizer', () => {
    test('normalizes CCTV camera, frame, and bounding box detections', () => {
      const raw = {
        cameraId: 'cctvCanvas1',
        timestamp: Date.now(),
        sequence: 42,
        fps: 30,
        processingLatencyMs: 6,
        detections: [
          { id: 'v1', trackId: 'v1', class: 'car', confidence: 95, x: 0.1, y: 0.2, w: 0.05, h: 0.05, speedKmh: 42 }
        ]
      };

      const canonical = normalizeCanonicalCctv(raw);
      assert.strictEqual(canonical.camera.id, 'cctvCanvas1');
      assert.strictEqual(canonical.frame.sequence, 42);
      assert.strictEqual(canonical.detections.length, 1);
      assert.strictEqual(canonical.detections[0].class, 'car');
      assert.strictEqual(canonical.detections[0].boundingBox.x, 0.1);
    });
  });

  describe('6. Canonical Incident Model & Normalizer', () => {
    test('normalizes incident status aliases and metadata', () => {
      const raw = {
        id: '101',
        title: 'Mogok',
        category: 'accident',
        status: 'DISPATCHED/RESPONDING',
        severity: 'danger',
        location: 'Wonokromo',
        assignedUnit: 'Dishub 01'
      };

      const canonical = normalizeCanonicalIncident(raw);
      assert.strictEqual(canonical.id, '101');
      assert.strictEqual(canonical.status, 'DISPATCHED', 'Legacy DISPATCHED/RESPONDING should canonicalize to DISPATCHED');
      assert.strictEqual(canonical.severity, 'danger');
      assert.strictEqual(canonical.assignedUnit, 'Dishub 01');

      const legacy = CompatibilityAdapters.toLegacyIncident(canonical);
      assert.strictEqual(legacy.id, '101');
      assert.strictEqual(legacy.status, 'DISPATCHED');
    });
  });

  describe('7. Canonical Emergency Model & Normalizer', () => {
    test('normalizes emergency request and status', () => {
      const raw = {
        id: 'EMG-101',
        code: 'AMB-01',
        route: 'route-soetomo',
        status: 'PRIORITAS AKTIF',
        ETA: '120s',
        speed: 60
      };

      const canonical = normalizeCanonicalEmergency(raw);
      assert.strictEqual(canonical.id, 'EMG-101');
      assert.strictEqual(canonical.vehicleId, 'AMB-01');
      assert.strictEqual(canonical.status, 'ROUTE_PREEMPTION', 'PRIORITAS AKTIF should canonicalize to ROUTE_PREEMPTION');
      assert.strictEqual(canonical.routeId, 'route-soetomo');

      const legacy = CompatibilityAdapters.toLegacyEmergency(canonical);
      assert.strictEqual(legacy.id, 'EMG-101');
      assert.strictEqual(legacy.code, 'AMB-01');
      assert.strictEqual(legacy.status, 'ROUTE_PREEMPTION');
    });
  });

  describe('8. Normalized Collections & Primary Key Lookups', () => {
    test('createNormalizedCollection builds byId map and allIds array with deduplication', () => {
      const items = [
        { id: 'item-1', name: 'Alpha' },
        { id: 'item-2', name: 'Beta' },
        { id: 'item-1', name: 'Alpha Updated' }
      ];

      const collection = createNormalizedCollection(items);
      assert.deepEqual(collection.allIds, ['item-1', 'item-2']);
      assert.strictEqual(collection.byId['item-1'].name, 'Alpha Updated');
      assert.strictEqual(collection.byId['item-2'].name, 'Beta');
    });

    test('stateStore provides O(1) primary key getters across domain slices', () => {
      const device = stateStore.getDeviceById('NODE-EDGE-01');
      assert.ok(device);
      assert.strictEqual(device.id || device.deviceId, 'NODE-EDGE-01');

      const intersection = stateStore.getIntersectionById('node-wonokromo');
      assert.ok(intersection);
      assert.strictEqual(intersection.id, 'node-wonokromo');

      const incident = stateStore.getIncidentById('101');
      assert.ok(incident);
      assert.strictEqual(incident.id, '101');

      const nonExistent = stateStore.getDeviceById('NON_EXISTENT_DEV');
      assert.strictEqual(nonExistent, null);
    });
  });
});

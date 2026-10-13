import test from 'node:test';
import assert from 'node:assert/strict';
import { ComputerVisionEngine } from '../../server/services/visionEngine.js';
import { UnifiedClock, SIMULATION_MODES } from '../../server/services/unifiedClock.js';
import { DeterministicRandomRegistry } from '../../server/services/seededRandom.js';

test('synthetic CCTV feed follows per-camera corridor state and preserves vehicle dynamics', () => {
  const vision = new ComputerVisionEngine({
    clock: new UnifiedClock({ mode: SIMULATION_MODES.TEST, startTime: 1700000000000 }),
    randomRegistry: new DeterministicRandomRegistry(412)
  });
  const model = {
    corridors: [
      { corridorId: 'corridor-ayani', demandVehPerHour: 2100, queueVehicles: 24, congestionIndex: 76, speedKmh: 18.4 },
      { corridorId: 'corridor-darmo', demandVehPerHour: 1500, queueVehicles: 8, congestionIndex: 42, speedKmh: 31.2 },
      { corridorId: 'corridor-jemursari', demandVehPerHour: 1200, queueVehicles: 12, congestionIndex: 57, speedKmh: 25.5, intersectionId: 'node-jemursari' },
      { corridorId: 'corridor-merr', demandVehPerHour: 800, queueVehicles: 2, congestionIndex: 20, speedKmh: 42.1 }
    ], averageSpeedKmh: 31.3, demandVehPerHour: 5600, queueVehicles: 46, congestionIndex: 58
  };
  const frame = vision.generateFramePayload(false, model, { trafficModel: model, intersections: [] });
  for (const [camera, corridorId] of [['cctvCanvas1', 'corridor-ayani'], ['cctvCanvas2', 'corridor-darmo'], ['cctvCanvas4', 'corridor-jemursari']]) {
    const cameraFrame = frame.cameras[camera];
    const expected = model.corridors.find(item => item.corridorId === corridorId);
    assert.equal(cameraFrame.trafficMetrics.corridorId, corridorId);
    assert.equal(cameraFrame.trafficMetrics.speedKmh, expected.speedKmh);
    assert.ok(cameraFrame.detections.every(detection => detection.speedKmh >= 0 && detection.speedKmh <= expected.speedKmh));
    assert.ok(cameraFrame.detections.every(detection => Number.isInteger(detection.lane) && Number.isFinite(detection.progress)));
    assert.equal(cameraFrame.trafficMetrics.provenance, 'SIMULATED');
  }
  assert.equal(frame.cameras.cctvCanvas3.trafficMetrics.scope, 'network-average');
  assert.equal(frame.cameras.cctvCanvas3.intersectionId, null);
  assert.equal(frame.cameras.cctvCanvas3.scene, 'roundabout');
  assert.equal(frame.cameras.cctvCanvas4.intersectionId, 'node-jemursari');
  assert.equal(frame.cameras.cctvCanvas1.source, 'OmniTRAF procedural traffic simulation');
  assert.equal('resolution' in frame.cameras.cctvCanvas1, false);
});

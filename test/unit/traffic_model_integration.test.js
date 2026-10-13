import test from 'node:test';
import assert from 'node:assert/strict';
import { ComputerVisionEngine } from '../../server/services/visionEngine.js';
import { UnifiedClock, SIMULATION_MODES } from '../../server/services/unifiedClock.js';
import { DeterministicRandomRegistry } from '../../server/services/seededRandom.js';

test('synthetic CCTV speed and corridor telemetry project the same simulator values', () => {
  const vision = new ComputerVisionEngine({
    clock: new UnifiedClock({ mode: SIMULATION_MODES.TEST, startTime: 1700000000000 }),
    randomRegistry: new DeterministicRandomRegistry(412)
  });
  const model = {
    corridors: [
      { corridorId: 'corridor-ayani', demandVehPerHour: 2100, queueVehicles: 24, congestionIndex: 76, speedKmh: 18.4 },
      { corridorId: 'corridor-darmo', demandVehPerHour: 1500, queueVehicles: 8, congestionIndex: 42, speedKmh: 31.2 },
      { corridorId: 'corridor-jemursari', demandVehPerHour: 1200, queueVehicles: 12, congestionIndex: 57, speedKmh: 25.5 },
      { corridorId: 'corridor-merr', demandVehPerHour: 800, queueVehicles: 2, congestionIndex: 20, speedKmh: 42.1 }
    ]
  };
  const frame = vision.generateFramePayload(false, model);
  for (const [camera, corridorId] of [['cctvCanvas1', 'corridor-ayani'], ['cctvCanvas2', 'corridor-darmo'], ['cctvCanvas3', 'corridor-jemursari'], ['cctvCanvas4', 'corridor-merr']]) {
    const cameraFrame = frame.cameras[camera];
    const expected = model.corridors.find(item => item.corridorId === corridorId);
    assert.equal(cameraFrame.trafficMetrics.corridorId, corridorId);
    assert.equal(cameraFrame.trafficMetrics.speedKmh, expected.speedKmh);
    assert.ok(cameraFrame.detections.every(detection => detection.speedKmh === Math.round(expected.speedKmh)));
    assert.equal(cameraFrame.trafficMetrics.provenance, 'SIMULATED');
  }
});

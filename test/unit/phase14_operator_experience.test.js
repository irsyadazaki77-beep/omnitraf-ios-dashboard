import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendAdaptiveSignal, simulateTrafficNetwork } from '../../src/modules/trafficModel.js';

test('operator recommendation preserves fairness bounds and deterministic preview assumptions', () => {
  const state = {
    simulatedHour: 8,
    simulation: { seed: 17 },
    intersections: [{ id: 'node-wonokromo', name: 'Wonokromo', greenSplit: 42, queueVehicles: 80, vehicleDemandVehPerHour: 1100, opposingDemandShare: 0.5 }],
    incidents: [], activeEmergencies: []
  };
  const recommendation = recommendAdaptiveSignal(state.intersections[0], state);
  assert.ok(recommendation.targetGreenSec >= recommendation.minimumGreenSec);
  assert.ok(recommendation.targetGreenSec <= recommendation.maximumGreenSec);
  assert.match(recommendation.reason, /antrean/i);
  const baseline = simulateTrafficNetwork(state, { seed: 17, horizonMinutes: 15 });
  const initialQueues = Object.fromEntries(baseline.corridors.map((corridor) => [corridor.corridorId, corridor.initialQueueVehicles]));
  const adjustedState = {
    ...state,
    intersections: state.intersections.map((node) => ({ ...node, greenSplit: recommendation.targetGreenSec, pendingGreenSplit: recommendation.targetGreenSec }))
  };
  const firstPreview = simulateTrafficNetwork(adjustedState, { seed: 17, horizonMinutes: 15, initialQueues });
  const secondPreview = simulateTrafficNetwork(adjustedState, { seed: 17, horizonMinutes: 15, initialQueues });
  assert.deepEqual(firstPreview, secondPreview);
  assert.equal(firstPreview.provenance, 'SIMULATED');
  assert.equal(firstPreview.horizonMinutes, 15);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backendState } from '../../server/services/stateManager.js';

test('synthetic emergency priority preserves yellow, all-red, bounded green, and recovery phases', () => {
  const node = backendState.state.intersections.find(item => item.id === 'node-wonokromo');
  const snapshot = { ...node };
  try {
    const now = backendState.clock.now();
    backendState._startEmergencySignalClearance(node, 'EMG-CLEARANCE-TEST', now);
    assert.equal(node.state, 'yellow');
    assert.equal(node.preemptionPhase, 'YELLOW_CLEARANCE');
    assert.equal(node.timer, node.yellowDuration || 3);

    node.preemptionPhaseEndsAtMs = backendState.clock.now() - 1;
    backendState._stepSignalSimulation();
    assert.equal(node.preemptionPhase, 'ALL_RED_CLEARANCE');
    assert.equal(node.state, 'yellow');

    node.preemptionPhaseEndsAtMs = backendState.clock.now() - 1;
    backendState._stepSignalSimulation();
    assert.equal(node.preemptionPhase, 'PRIORITY_GREEN');
    assert.equal(node.state, 'red');
    assert.ok(node.preemptionPhaseEndsAtMs - backendState.clock.now() <= 90_000);
    assert.ok(node.preemptionPhaseEndsAtMs - backendState.clock.now() >= 15_000);

    backendState._stepSignalSimulation();
    assert.equal(node.state, 'green');
    assert.ok(node.timer <= 90 && node.timer >= 15);
    node.preemptionPhaseEndsAtMs = backendState.clock.now() - 1;
    backendState._stepSignalSimulation();
    assert.equal(node.preemptionPhase, 'RECOVERY_CLEARANCE');
    assert.equal(node.state, 'yellow');

    node.preemptionPhaseEndsAtMs = backendState.clock.now() - 1;
    backendState._stepSignalSimulation();
    assert.equal(node.isPreempted, false);
    assert.equal(node.state, 'red');
    assert.match(node.status, /clearance merah/);
  } finally {
    for (const key of Object.keys(node)) delete node[key];
    Object.assign(node, snapshot);
  }
});

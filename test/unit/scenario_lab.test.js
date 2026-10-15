import test from 'node:test';
import assert from 'node:assert/strict';
import { ScenarioLabService, normalizeLabConfig } from '../../server/services/scenarioLabService.js';

function stateFixture() {
  return {
    stateVersion: 91,
    timestamp: '08:00',
    intersections: [
      { id: 'node-wonokromo', queueVehicles: 11, greenSplit: 35 },
      { id: 'node-jemursari', queueVehicles: 7, greenSplit: 38 },
      { id: 'node-darmo', queueVehicles: 5, greenSplit: 36 }
    ],
    incidents: [{ id: 'live-incident', title: 'live incident', location: 'MERR', severity: 'low', status: 'ACTIVE' }]
  };
}

function fixtureService() {
  const liveState = stateFixture();
  return { liveState, service: new ScenarioLabService({ getState: () => liveState }) };
}

test('Scenario Lab validates controls to the supported model ranges', () => {
  assert.deepEqual(normalizeLabConfig({}), {
    seed: 42, hour: 8, horizonMinutes: 30, demandMultiplier: 1,
    corridorId: 'all', weather: 'clear', incidentSeverity: 'none', signalStrategy: 'fixed'
  });
  for (const config of [
    { seed: -1 }, { hour: 24 }, { horizonMinutes: 121 }, { demandMultiplier: 2 },
    { corridorId: 'unknown' }, { weather: 'snow' }, { incidentSeverity: 'extreme' }, { signalStrategy: 'manual-live' }
  ]) assert.throws(() => normalizeLabConfig(config), /must|not supported/);
});

test('same seed and isolated initial state reproduce the same model timeline', () => {
  const { service } = fixtureService();
  const config = { seed: 412, hour: 17, horizonMinutes: 3, corridorId: 'corridor-ayani', demandMultiplier: 1.2, weather: 'rain', signalStrategy: 'adaptive' };
  const first = service.create('operator-1', config);
  const second = service.create('operator-1', config);
  service.control(first.id, 'operator-1', 'play');
  service.control(second.id, 'operator-1', 'play');
  const firstResult = service.control(first.id, 'operator-1', 'step');
  const secondResult = service.control(second.id, 'operator-1', 'step');
  assert.equal(firstResult.initialStateVersion, 91);
  assert.deepEqual(firstResult.metrics, secondResult.metrics);
  assert.deepEqual(firstResult.timeline, secondResult.timeline);
  assert.equal(firstResult.isolated, true);
});

test('pause, reset, replay, scheduled markers, and cleanup retain sandbox boundaries', () => {
  const { liveState, service } = fixtureService();
  const before = structuredClone(liveState);
  const created = service.create('operator-1', { seed: 9, hour: 8, horizonMinutes: 4, incidentSeverity: 'critical' });
  service.control(created.id, 'operator-1', 'play');
  const first = service.control(created.id, 'operator-1', 'step');
  assert.equal(first.elapsedMinutes, 1);
  service.control(created.id, 'operator-1', 'pause');
  const paused = service.control(created.id, 'operator-1', 'step');
  assert.equal(paused.elapsedMinutes, 1);
  service.control(created.id, 'operator-1', 'play');
  const incident = service.control(created.id, 'operator-1', 'step');
  assert.equal(incident.markers[0].minute, 2);
  assert.equal(incident.modelScenario.incidentCount, 1);
  const reset = service.control(created.id, 'operator-1', 'reset');
  assert.equal(reset.status, 'idle');
  assert.equal(reset.metrics, null);
  const replay = service.control(created.id, 'operator-1', 'replay');
  assert.equal(replay.status, 'running');
  assert.deepEqual(liveState, before);
  service.remove(created.id, 'operator-1');
  assert.throws(() => service.snapshot(created.id, 'operator-1'), /not found/);
});

test('comparison fixes seed, horizon, and initial state for both alternatives', () => {
  const { service } = fixtureService();
  const comparison = service.compare({ baseline: 'normal', alternative: 'heavy-rain', seed: 722, hour: 17, horizonMinutes: 30, corridorId: 'all' });
  assert.equal(comparison.sameInitialState, true);
  assert.equal(comparison.seed, 722);
  assert.equal(comparison.horizonMinutes, 30);
  assert.equal(comparison.baseline.metrics.queueConservationResidual, 0);
  assert.notEqual(comparison.baseline.metrics.averageSpeedKmh, comparison.alternative.metrics.averageSpeedKmh);
  assert.throws(() => service.compare({ baseline: 'not-a-preset', alternative: 'normal' }), /unknown/);
});

test('corridor-specific incidents affect only the selected model corridor', () => {
  const { service } = fixtureService();
  const session = service.create('operator-1', { seed: 5, hour: 8, horizonMinutes: 2, corridorId: 'corridor-jemursari', incidentSeverity: 'critical' });
  service.control(session.id, 'operator-1', 'play');
  service.control(session.id, 'operator-1', 'step');
  const result = service.control(session.id, 'operator-1', 'step');
  const ayani = result.corridors.find(corridor => corridor.corridorId === 'corridor-ayani');
  const jemursari = result.corridors.find(corridor => corridor.corridorId === 'corridor-jemursari');
  assert.equal(ayani.incidentCapacityLossPct, 0);
  assert.equal(jemursari.incidentCapacityLossPct, 58);
});

test('sessions are scoped to their owner and live operational incidents are isolated', () => {
  const { service } = fixtureService();
  const session = service.create('operator-1', { horizonMinutes: 2 });
  assert.throws(() => service.snapshot(session.id, 'operator-2'), /not found/);
  service.control(session.id, 'operator-1', 'play');
  const result = service.control(session.id, 'operator-1', 'step');
  assert.equal(result.modelScenario.incidentCount, 0);
});

test('road-closure preset is registered and produces deterministic capacity reduction', () => {
  const { service } = fixtureService();
  const { presets } = service.listPresets();
  const roadClosure = presets.find(p => p.id === 'road-closure');
  assert.ok(roadClosure, 'road-closure preset must exist');
  assert.equal(presets.length, 7, 'all 7 scenario presets must be registered');

  const comparison = service.compare({
    baseline: 'normal',
    alternative: 'road-closure',
    seed: 101,
    hour: 8,
    horizonMinutes: 15,
    corridorId: 'all'
  });
  assert.equal(comparison.sameInitialState, true);
  assert.equal(comparison.alternative.id, 'road-closure');
  assert.ok(comparison.delta.queueMeters >= 0, 'road closure increases or preserves modeled queue');
});


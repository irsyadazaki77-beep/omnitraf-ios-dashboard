import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { UnifiedClock, SIMULATION_MODES } from '../../server/services/unifiedClock.js';
import { DeterministicRandomRegistry } from '../../server/services/seededRandom.js';
import { DeterministicSimulationEngine } from '../../server/services/simulationEngine.js';
import { ScenarioRegistry } from '../../server/services/scenarioRegistry.js';
import { ScenarioRunner } from '../../server/services/scenarioRunner.js';
import { BackendStateManager } from '../../server/services/stateManager.js';

function createEngine(seed = 17) {
  const clock = new UnifiedClock({ mode: SIMULATION_MODES.TEST, startTime: 1000 });
  return new DeterministicSimulationEngine({ clock, randomRegistry: new DeterministicRandomRegistry(seed), tickResolution: 100 });
}

describe('Phase 8 simulation lifecycle refinement', () => {
  test('same seed and schedule produce the same domain output', () => {
    const run = () => {
      const engine = createEngine(91);
      const output = [];
      engine.registerDomain('traffic', 10, ({ prng, scheduledEvents }) => {
        output.push({ value: prng.nextInt(1, 100), events: scheduledEvents.map(event => event.type) });
      });
      engine.scheduleEvent(1100, 'input.first', { value: 1 });
      engine.scheduleEvent(1100, 'input.second', { value: 2 });
      for (let i = 0; i < 3; i++) engine.step(100);
      return output;
    };
    assert.deepEqual(run(), run());
    assert.deepEqual(run()[0].events, ['input.first', 'input.second']);
    assert.deepEqual(run()[1].events, []);
  });

  test('pause freezes clock, domain calls, and random stream consumption; resume continues', () => {
    const engine = createEngine();
    let calls = 0;
    engine.registerDomain('traffic', 1, ({ prng }) => { calls++; prng.next(); });
    engine.step(100);
    const before = engine.randomRegistry.getStream('traffic').getSnapshot();
    engine.pause();
    const result = engine.step(100);
    assert.equal(result.paused, true);
    assert.equal(engine.clock.now(), 1100);
    assert.equal(calls, 1);
    assert.deepEqual(engine.randomRegistry.getStream('traffic').getSnapshot(), before);
    engine.resume().step(100);
    assert.equal(engine.clock.now(), 1200);
    assert.equal(calls, 2);
  });

  test('equal-time events keep insertion order and execute once', () => {
    const engine = createEngine();
    const seen = [];
    engine.registerDomain('collector', 1, ({ scheduledEvents }) => seen.push(...scheduledEvents.map(event => event.payload.id)));
    engine.scheduleEvent(1050, 'test', { id: 'first' });
    engine.scheduleEvent(1050, 'test', { id: 'second' });
    engine.step(100);
    engine.step(100);
    assert.deepEqual(seen, ['first', 'second']);
    assert.equal(engine.getDiagnostics().eventQueueSize, 0);
  });

  test('reset restores clock, RNG, counters and pending events reproducibly', () => {
    const engine = createEngine(33);
    const values = [];
    engine.registerDomain('traffic', 1, ({ prng }) => values.push(prng.next()));
    engine.scheduleEvent(2000, 'pending');
    engine.step(100);
    const firstValue = values[0];
    engine.reset({ startTime: 1000, seed: 33 });
    engine.step(100);
    assert.equal(values[1], firstValue);
    assert.equal(engine.tickSequence, 1);
    assert.equal(engine.clock.now(), 1100);
    assert.equal(engine.scheduler.size, 0);
  });

  test('bad domain is isolated and invalid deltas are rejected', () => {
    const engine = createEngine();
    let healthyCalls = 0;
    engine.registerDomain('broken', 1, () => { throw new Error('fixture failure'); });
    engine.registerDomain('healthy', 2, () => { healthyCalls++; });
    engine.step(100);
    assert.equal(healthyCalls, 1);
    assert.equal(engine.getDiagnostics().errors[0].domain, 'broken');
    assert.throws(() => engine.step(Number.NaN), /finite positive/);
    assert.throws(() => engine.scheduleEvent(-1, 'invalid'), /timestamp/);
  });

  test('malformed checkpoint is rejected before engine state changes', () => {
    const engine = createEngine();
    let value = 3;
    engine.registerDomain('snapshot-state', 1, () => {}, {
      snapshot: () => ({ value }),
      restore: snapshot => { value = snapshot.value; }
    });
    engine.step(100);
    const checkpoint = engine.createCheckpoint();
    const malformed = structuredClone(checkpoint);
    malformed.scheduler.queue.push({ at: Number.NaN, type: 'bad', payload: null, sequence: 1 });
    assert.throws(() => engine.restoreCheckpoint(malformed), /invalid scheduled event/);
    assert.equal(engine.clock.now(), 1100);
    assert.equal(engine.tickSequence, 1);
    assert.equal(value, 3);
  });

  test('scenario definition validates input, runs events once, and has pause/resume/reset lifecycle', () => {
    const engine = createEngine(1);
    let counter = 5;
    const events = [];
    engine.registerDomain('counter', 1, ({ scheduledEvents, deltaMs }) => {
      counter += deltaMs;
      events.push(...scheduledEvents.map(event => event.type));
    }, {
      snapshot: () => ({ counter }),
      restore: snapshot => { counter = snapshot.counter; },
      reset: () => { counter = 5; }
    });
    const registry = new ScenarioRegistry([{
      id: 'fixture-scenario', name: 'Fixture', seed: 77, startTime: 2000, durationMs: 200,
      events: [{ at: 100, type: 'test.one' }, { at: 100, type: 'test.two' }]
    }]);
    const runner = new ScenarioRunner({ engine, registry });
    const baselineCounter = counter;

    runner.start('fixture-scenario');
    assert.equal(counter, 5);
    runner.step(100);
    assert.deepEqual(events, ['test.one', 'test.two']);
    assert.deepEqual(engine.eventJournal.map(event => event.type), ['test.one', 'test.two']);
    runner.pause();
    const pausedAt = engine.clock.now();
    const pausedCounter = counter;
    assert.equal(runner.step(100).paused, true);
    assert.equal(engine.clock.now(), pausedAt);
    assert.equal(counter, pausedCounter);
    runner.resume();
    const completed = runner.step(100);
    assert.equal(completed.simTimeMs, 2200);
    assert.equal(runner.status, 'completed');
    runner.reset();
    assert.equal(counter, baselineCounter);
    assert.equal(engine.clock.now(), 1000);
    assert.equal(runner.status, 'idle');
  });

  test('scenario registry rejects unknown ids and malformed event payloads', () => {
    assert.throws(() => new ScenarioRegistry([{ id: 'x', name: 'Bad', seed: 1, startTime: 0, durationMs: 1, events: [{ at: 2, type: 'late' }] }]), /invalid time/);
    assert.throws(() => new ScenarioRegistry([{ id: 'x', name: 'Bad', seed: 1, startTime: 0, durationMs: 1, events: [{ at: 0, type: 'bad', payload: { value: Number.NaN } }] }]), /NaN or Infinity/);
    const runner = new ScenarioRunner({ engine: createEngine(), registry: new ScenarioRegistry() });
    assert.throws(() => runner.start('missing'), /unknown scenario/);
  });

  test('backend state manager runs explicit simulation phases and restores its hydrated baseline', async () => {
    const clock = new UnifiedClock({ mode: SIMULATION_MODES.TEST, startTime: 5000 });
    const manager = new BackendStateManager({ clock, seed: 1234, mode: SIMULATION_MODES.TEST });
    await manager.init();
    const baseline = structuredClone(manager.state);
    manager.tick(1000);
    assert.equal(clock.now(), 6000);
    assert.deepEqual(manager.simEngine.getDiagnostics().activeModules, [
      'device-telemetry', 'emergency-response', 'signal-cycle', 'state-bootstrap', 'state-finalize'
    ]);
    const realtimeEvents = [];
    manager.setIo({ emit: (name, payload) => realtimeEvents.push({ name, payload }) });
    manager._queueSimulationEvent('incident:update', { id: 'INC-ADAPTER-TEST', seq: 1, source: 'server', payload: { id: 'INC-ADAPTER-TEST' } });
    assert.equal(realtimeEvents.length, 0);
    manager._dispatchSimulationEvents();
    assert.equal(realtimeEvents[0].name, 'incident:update');
    assert.ok(Number.isFinite(realtimeEvents[0].payload.timestamp));
    manager.state.incidents.unshift({ id: 'INC-OPERATOR-PRESERVE', status: 'ACTIVE' });
    manager.state.intersections[0].greenSplit = 44;
    manager.state.intersections[0].pendingGreenSplit = 46;
    manager.devicesRegistry[0].fps = 21;
    const currentSequence = manager.sequence;
    manager.simEngine.reset({ startTime: 5000, seed: 1234 });
    assert.equal(manager.state.seq, currentSequence);
    assert.equal(manager.sequence, currentSequence);
    assert.equal(manager.state.networkLoad, baseline.networkLoad);
    assert.equal(manager.state.intersections[0].greenSplit, 44);
    assert.equal(manager.state.intersections[0].pendingGreenSplit, 46);
    assert.equal(manager.devicesRegistry[0].fps, 21);
    assert.equal(manager.state.incidents[0].id, 'INC-OPERATOR-PRESERVE');
  });

  test('rapid scenario pause, resume, and reset cycles leave no queued work or state drift', () => {
    const engine = createEngine(8);
    let counter = 0;
    engine.registerDomain('counter', 1, ({ deltaMs }) => { counter += deltaMs; }, {
      snapshot: () => ({ counter }),
      restore: snapshot => { counter = snapshot.counter; },
      reset: () => { counter = 0; }
    });
    const runner = new ScenarioRunner({
      engine,
      registry: new ScenarioRegistry([{ id: 'stress', name: 'Stress fixture', seed: 8, startTime: 3000, durationMs: 5000, events: [{ at: 1000, type: 'fixture.event' }] }])
    });

    for (let i = 0; i < 20; i++) {
      runner.start('stress');
      runner.pause();
      runner.step(100);
      runner.resume();
      runner.step(100);
      runner.reset();
      assert.equal(counter, 0);
      assert.equal(engine.clock.now(), 1000);
      assert.equal(engine.scheduler.size, 0);
      assert.equal(runner.status, 'idle');
    }
  });
});

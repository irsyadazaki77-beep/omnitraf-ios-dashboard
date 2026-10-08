import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';

import { UnifiedClock, SIMULATION_MODES } from '../../server/services/unifiedClock.js';
import { SeededRandom, DeterministicRandomRegistry } from '../../server/services/seededRandom.js';
import { DeterministicSimulationEngine } from '../../server/services/simulationEngine.js';
import { BackendStateManager } from '../../server/services/stateManager.js';
import { VisionEngine } from '../../server/services/visionEngine.js';
import { generateForecastSnapshot } from '../../src/modules/forecastEngine.js';

describe('PHASE 19 — Unified Time, Seeded Randomness & Deterministic Simulation Engine', () => {

  describe('1. Unified Clock Abstraction & Monotonic Guarantees', () => {
    test('Wall clock, monotonic clock, and simulation clock have independent semantics', () => {
      const clock = new UnifiedClock({
        mode: SIMULATION_MODES.TEST,
        startTime: 1000000,
        speedMultiplier: 1.0,
        paused: false
      });

      assert.strictEqual(clock.now(), 1000000);
      assert.strictEqual(clock.paused, false);
      assert.strictEqual(clock.mode, SIMULATION_MODES.TEST);

      // Advance fake simulation clock
      clock.advance(5000);
      assert.strictEqual(clock.now(), 1005000);
      assert.strictEqual(clock.elapsedSince(1000000), 5000);

      // Monotonic clock is strictly non-negative and independent of simulation pause/advance
      const mono = clock.monotonic();
      assert.ok(mono >= 0);
      
      // Formatting
      const iso = clock.nowIso();
      assert.strictEqual(iso, new Date(1005000).toISOString());
    });

    test('Simulation speed multiplier scales advance time accurately', () => {
      const clock = new UnifiedClock({
        mode: SIMULATION_MODES.SIMULATED,
        startTime: 1000,
        speedMultiplier: 4.0,
        paused: false
      });

      clock.advance(1000); // 1000ms real advance at 4x speed = 4000ms sim advance
      assert.strictEqual(clock.now(), 5000);

      clock.setSpeedMultiplier(0.5);
      clock.advance(2000); // 2000ms * 0.5 = 1000ms sim advance
      assert.strictEqual(clock.now(), 6000);
    });

    test('Pausing freezes simulation clock while monotonic continues', () => {
      const clock = new UnifiedClock({
        mode: SIMULATION_MODES.SIMULATED,
        startTime: 50000,
        paused: false
      });

      clock.advance(2000);
      assert.strictEqual(clock.now(), 52000);

      clock.pause();
      assert.strictEqual(clock.paused, true);
      clock.advance(5000); // Should not advance when paused
      assert.strictEqual(clock.now(), 52000);

      clock.resume();
      assert.strictEqual(clock.paused, false);
      clock.advance(3000);
      assert.strictEqual(clock.now(), 55000);
    });
  });

  describe('2. Seeded PRNG & Stream Isolation', () => {
    test('Same seed produces bit-for-bit identical pseudo-random sequence', () => {
      const prng1 = new SeededRandom(12345);
      const prng2 = new SeededRandom(12345);

      const seq1 = Array.from({ length: 10 }, () => prng1.next());
      const seq2 = Array.from({ length: 10 }, () => prng2.next());

      assert.deepStrictEqual(seq1, seq2);
    });

    test('Different seed produces distinct variations', () => {
      const prng1 = new SeededRandom(11111);
      const prng2 = new SeededRandom(99999);

      const val1 = prng1.next();
      const val2 = prng2.next();

      assert.notStrictEqual(val1, val2);
    });

    test('Domain stream isolation ensures traffic calls do not affect cctv or device streams', () => {
      const reg1 = new DeterministicRandomRegistry(42);
      const reg2 = new DeterministicRandomRegistry(42);

      // In reg1, simulate heavy traffic random draws
      const trafficStream1 = reg1.getStream('traffic');
      for (let i = 0; i < 50; i++) trafficStream1.next();

      // Device streams in both registries should produce identical sequences
      const devStream1 = reg1.getStream('devices');
      const devStream2 = reg2.getStream('devices');

      const devSeq1 = Array.from({ length: 5 }, () => devStream1.nextInt(0, 100));
      const devSeq2 = Array.from({ length: 5 }, () => devStream2.nextInt(0, 100));

      assert.deepStrictEqual(devSeq1, devSeq2);
    });
  });

  describe('3. Deterministic Simulation Engine & Execution Order', () => {
    test('Handlers execute in strict priority order with deterministic event recording', () => {
      const clock = new UnifiedClock({ mode: SIMULATION_MODES.TEST, startTime: 10000 });
      const engine = new DeterministicSimulationEngine({ clock });

      const executionOrder = [];

      engine.registerHandler('incidentDomain', (ctx) => {
        executionOrder.push('incident');
        engine.recordEvent({ type: 'INCIDENT_TICK', simulationTime: ctx.simTimeMs });
      }, 30);

      engine.registerHandler('trafficDomain', (ctx) => {
        executionOrder.push('traffic');
        engine.recordEvent({ type: 'TRAFFIC_TICK', simulationTime: ctx.simTimeMs });
      }, 10);

      engine.registerHandler('emergencyDomain', (ctx) => {
        executionOrder.push('emergency');
        engine.recordEvent({ type: 'EMERGENCY_TICK', simulationTime: ctx.simTimeMs });
      }, 20);

      // Execute tick
      engine.tick(1000);


      assert.deepStrictEqual(executionOrder, ['traffic', 'emergency', 'incident']);
      assert.strictEqual(engine.eventSequence, 3);
      assert.strictEqual(engine.eventJournal[0].type, 'TRAFFIC_TICK');
      assert.strictEqual(engine.eventJournal[1].type, 'EMERGENCY_TICK');
      assert.strictEqual(engine.eventJournal[2].type, 'INCIDENT_TICK');
      assert.strictEqual(engine.eventJournal[0].sequence, 1);
      assert.strictEqual(engine.eventJournal[2].sequence, 3);
    });
  });

  describe('4. Simulation Reproducibility Across Runs', () => {
    test('Two independent BackendStateManager instances with same seed produce identical state transitions', () => {
      const fixedStartTime = 1700000000000;
      const seed = 98765;

      const clock1 = new UnifiedClock({ mode: SIMULATION_MODES.TEST, startTime: fixedStartTime });
      const reg1 = new DeterministicRandomRegistry(seed);
      const engine1 = new DeterministicSimulationEngine({ clock: clock1 });
      const stateMgr1 = new BackendStateManager({
        clock: clock1,
        randomRegistry: reg1,
        simEngine: engine1,
        mode: SIMULATION_MODES.TEST,
        seed
      });

      const clock2 = new UnifiedClock({ mode: SIMULATION_MODES.TEST, startTime: fixedStartTime });
      const reg2 = new DeterministicRandomRegistry(seed);
      const engine2 = new DeterministicSimulationEngine({ clock: clock2 });
      const stateMgr2 = new BackendStateManager({
        clock: clock2,
        randomRegistry: reg2,
        simEngine: engine2,
        mode: SIMULATION_MODES.TEST,
        seed
      });

      // Run 20 ticks of 1000ms each
      for (let i = 0; i < 20; i++) {
        stateMgr1.tick(1000);
        stateMgr2.tick(1000);
      }

      // Check key metrics
      assert.strictEqual(stateMgr1.state.networkLoad, stateMgr2.state.networkLoad);
      assert.strictEqual(stateMgr1.state.avgWaitTime, stateMgr2.state.avgWaitTime);
      assert.strictEqual(stateMgr1.state.congestionIndex, stateMgr2.state.congestionIndex);
      assert.strictEqual(stateMgr1.vehiclesCountToday, stateMgr2.vehiclesCountToday);
      assert.strictEqual(stateMgr1.co2SavedKg, stateMgr2.co2SavedKg);
      assert.strictEqual(stateMgr1.fuelSavedLiters, stateMgr2.fuelSavedLiters);

      // Check intersections
      for (let j = 0; j < stateMgr1.state.intersections.length; j++) {
        const n1 = stateMgr1.state.intersections[j];
        const n2 = stateMgr2.state.intersections[j];
        assert.strictEqual(n1.state, n2.state);
        assert.strictEqual(n1.timer, n2.timer);
        assert.strictEqual(n1.status, n2.status);
      }

      // Check devices
      for (let k = 0; k < stateMgr1.state.devices.length; k++) {
        const d1 = stateMgr1.state.devices[k];
        const d2 = stateMgr2.state.devices[k];
        assert.strictEqual(d1.latencyMs, d2.latencyMs);
        assert.strictEqual(d1.temperatureC, d2.temperatureC);
        assert.strictEqual(d1.cpuPercent, d2.cpuPercent);
        assert.strictEqual(d1.healthScore, d2.healthScore);
        assert.strictEqual(d1.healthLevel, d2.healthLevel);
      }
    });

    test('Tick-size invariance: multiple small ticks (100ms x 10) vs single large tick (1000ms) produce consistent traffic signal state', () => {
      const fixedStartTime = 1700000000000;
      const seed = 555;

      const clockA = new UnifiedClock({ mode: SIMULATION_MODES.TEST, startTime: fixedStartTime });
      const stateMgrA = new BackendStateManager({
        clock: clockA,
        randomRegistry: new DeterministicRandomRegistry(seed),
        mode: SIMULATION_MODES.TEST,
        seed
      });

      const clockB = new UnifiedClock({ mode: SIMULATION_MODES.TEST, startTime: fixedStartTime });
      const stateMgrB = new BackendStateManager({
        clock: clockB,
        randomRegistry: new DeterministicRandomRegistry(seed),
        mode: SIMULATION_MODES.TEST,
        seed
      });

      // State A: 10 ticks of 100ms
      for (let i = 0; i < 10; i++) {
        stateMgrA.tick(100);
      }

      // State B: 1 tick of 1000ms
      stateMgrB.tick(1000);

      // Signal states and timers must match exactly because they are elapsed-time synchronized
      for (let j = 0; j < stateMgrA.state.intersections.length; j++) {
        assert.strictEqual(stateMgrA.state.intersections[j].state, stateMgrB.state.intersections[j].state);
        assert.strictEqual(stateMgrA.state.intersections[j].timer, stateMgrB.state.intersections[j].timer);
      }
    });
  });

  describe('5. Deterministic Emergency & Route Progression', () => {
    test('Emergency priority progression depends strictly on elapsed simulation time', async () => {
      const fixedStartTime = 1700000000000;
      const clock = new UnifiedClock({ mode: SIMULATION_MODES.TEST, startTime: fixedStartTime });
      const stateMgr = new BackendStateManager({
        clock,
        randomRegistry: new DeterministicRandomRegistry(777),
        mode: SIMULATION_MODES.TEST
      });

      // Dispatch emergency
      const res = await stateMgr.activateEmergencyPriority('AMB-TEST-01', 'route-soetomo', {
        priorityLevel: 'CRITICAL',
        assignedHospital: 'RSUD Dr. Soetomo',
        etaMinutes: 6
      });

      assert.ok(res.emergencyItem);
      const emgId = res.emergencyItem.id;
      assert.strictEqual(stateMgr.state.activeEmergencies.length, 1);
      assert.strictEqual(stateMgr.state.greenWaveActive, true);

      // Advance ticks to progress through state machine:
      // tick 1: REQUESTED -> VERIFIED
      stateMgr.tick(1000);
      // tick 2: VERIFIED -> DISPATCHED
      stateMgr.tick(1000);
      // tick 3: DISPATCHED -> EN_ROUTE
      stateMgr.tick(1000);
      // tick 4: EN_ROUTE progress over 30s
      stateMgr.tick(30000);

      const active = stateMgr.state.activeEmergencies.find(e => e.id === emgId);
      assert.ok(active);
      assert.strictEqual(active.status, 'EN_ROUTE');
      assert.ok(active.progress > 0, `Expected progress > 0, got ${active.progress}`);


      // Cancel emergency deterministically restores signals
      stateMgr.cancelEmergency(emgId);
      assert.strictEqual(stateMgr.state.greenWaveActive, false);
      const cancelled = stateMgr.state.activeEmergencies.find(e => e.id === emgId);
      assert.strictEqual(cancelled.status, 'CANCELLED');
    });
  });

  describe('6. Vision Engine CCTV Frame Determinism', () => {
    test('VisionEngine produces identical detections given identical clock and seed', () => {
      const fixedTime = 1700000000000;
      const clock1 = new UnifiedClock({ mode: SIMULATION_MODES.TEST, startTime: fixedTime });
      const prng1 = new SeededRandom(333);
      const vEngine1 = new VisionEngine({ clock: clock1, randomStream: prng1 });

      const clock2 = new UnifiedClock({ mode: SIMULATION_MODES.TEST, startTime: fixedTime });
      const prng2 = new SeededRandom(333);
      const vEngine2 = new VisionEngine({ clock: clock2, randomStream: prng2 });

      const frame1 = vEngine1.generateFramePayload(false);
      const frame2 = vEngine2.generateFramePayload(false);

      assert.strictEqual(frame1.seq, frame2.seq);
      assert.strictEqual(frame1.timestamp, frame2.timestamp);

      // Camera detections must match exactly
      const cams1 = Object.keys(frame1.cameras);
      const cams2 = Object.keys(frame2.cameras);
      assert.deepStrictEqual(cams1, cams2);

      for (const camId of cams1) {
        const dets1 = frame1.cameras[camId].detections;
        const dets2 = frame2.cameras[camId].detections;
        assert.strictEqual(dets1.length, dets2.length);
        for (let i = 0; i < dets1.length; i++) {
          assert.strictEqual(dets1[i].id, dets2[i].id);
          assert.strictEqual(dets1[i].class, dets2[i].class);
          assert.strictEqual(dets1[i].speedKmh, dets2[i].speedKmh);
          assert.ok(Math.abs(dets1[i].x - dets2[i].x) < 1e-9);
          assert.ok(Math.abs(dets1[i].y - dets2[i].y) < 1e-9);
        }
      }
    });
  });

  describe('7. Forecast & Recommendation Determinism', () => {
    test('Recommendation ID and recommendation content are stable across repeated calls', () => {
      const baselineState = {
        avgWaitTime: 50,
        congestionIndex: 75,
        networkLoad: 80,
        intersections: [
          { id: 'node-wonokromo', name: 'Wonokromo', greenSplit: 35, waitTime: 50 }
        ]
      };

      const res1 = generateForecastSnapshot(8.0, baselineState);
      const res2 = generateForecastSnapshot(8.0, baselineState);

      assert.ok(res1.recommendation);
      assert.ok(res2.recommendation);
      assert.strictEqual(res1.recommendation.id, res2.recommendation.id);
      assert.strictEqual(res1.recommendation.title, res2.recommendation.title);
      assert.strictEqual(res1.recommendation.action, res2.recommendation.action);
      assert.strictEqual(res1.recommendation.impactWaitSec, res2.recommendation.impactWaitSec);
    });
  });

  describe('8. Checkpointing & Replay Capability', () => {
    test('Checkpoint capture and replay reproduces the exact state', () => {
      const clock = new UnifiedClock({ mode: SIMULATION_MODES.TEST, startTime: 10000 });
      const engine = new DeterministicSimulationEngine({ clock, tickResolution: 100 });

      let counter = 0;
      engine.registerHandler('counterDomain', (ctx) => {
        counter += ctx.deltaMs;
        engine.recordEvent({ type: 'COUNT_ADVANCED', payload: { counter } });
      });

      // Tick 5 times with 100ms
      for (let i = 0; i < 5; i++) {
        engine.tick(100);
      }
      assert.strictEqual(counter, 500);


      // Create snapshot
      const snapshot = engine.createCheckpoint({ counter });

      // Run further to change state
      for (let i = 0; i < 5; i++) {
        engine.tick(100);
      }
      assert.strictEqual(counter, 1000);

      // Restore and replay from checkpoint
      const replayed = engine.replayFromCheckpoint(snapshot, 5);
      assert.strictEqual(replayed.stepsRun, 5);
      assert.strictEqual(replayed.finalTickSequence, 10);
    });
  });
});

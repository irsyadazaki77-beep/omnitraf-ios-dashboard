/**
 * OmniTRAF Surabaya - Deterministic Simulation Engine & Replay Framework (Phase 19)
 * 
 * Provides:
 * - Deterministic domain execution pipeline:
 *   1. Clock advance (by deltaMs * speedMultiplier)
 *   2. Input / fault events processing
 *   3. Domain state transitions (devices, traffic APILL, emergencies, incidents)
 *   4. Derived metrics & telemetry calculation
 *   5. Snapshot / Event logging (Event Envelope with monotonic sequence)
 *   6. Broadcast emission
 * - Pause / Resume / Step / SpeedMultiplier control
 * - Deterministic Checkpoint / Snapshot serialization (stripping non-serializable objects)
 * - Deterministic Event Journal & Replay Capability
 */

import { UnifiedClock, SIMULATION_MODES, systemClock } from './unifiedClock.js';
import { DeterministicRandomRegistry, defaultRandomRegistry } from './seededRandom.js';

export class DeterministicSimulationEngine {
  /**
   * @param {Object} options
   * @param {UnifiedClock} [options.clock]
   * @param {DeterministicRandomRegistry} [options.randomRegistry]
   * @param {number} [options.tickResolution=1000] - Base tick interval in ms
   * @param {number} [options.masterSeed=42]
   */
  constructor(options = {}) {
    this.clock = options.clock || systemClock;
    this.randomRegistry = options.randomRegistry || defaultRandomRegistry;
    this.tickResolution = options.tickResolution || 1000;
    this.tickSequence = 0;
    this.eventSequence = 0;
    this.domains = new Map(); // domainName -> { priority: number, handler: Function }
    this.eventJournal = []; // Monotonic deterministic event journal
    this.maxJournalLength = 500;
    this.isRunning = false;
    this._intervalId = null;
    this.lastTickMonotonic = 0;
    this.lastTickDurationMs = 0;
  }

  /**
   * Register a domain simulation step handler with execution priority.
   * Lower priority numbers run first.
   * e.g. Priority 10: Faults/inputs, 20: Devices, 30: Emergencies, 40: Traffic signals, 50: Metrics
   */
  registerDomain(name, priority, handler) {
    this.domains.set(name, { priority: Number(priority) || 50, handler });
    return this;
  }

  registerHandler(name, handler, priority = 50) {
    return this.registerDomain(name, priority, handler);
  }

  unregisterDomain(name) {
    this.domains.delete(name);
    return this;
  }

  tick(customDeltaMs = null) {
    return this.step(customDeltaMs);
  }

  step(customDeltaMs = null) {
    const t0 = this.clock.monotonic();
    const deltaMs = typeof customDeltaMs === 'number' ? customDeltaMs : this.tickResolution;

    // 1. Advance simulation clock (accounting for pause and speed multiplier)
    const prevSimTime = this.clock.now();
    const newSimTime = this.clock.advance(deltaMs, false);
    const actualSimDelta = newSimTime - prevSimTime;

    this.tickSequence++;

    // 2. Sort domains deterministically by priority
    const sortedDomains = Array.from(this.domains.entries()).sort((a, b) => a[1].priority - b[1].priority);

    // 3. Execute domain handlers in order
    const domainResults = {};
    for (const [domainName, entry] of sortedDomains) {
      const stream = this.randomRegistry.getStream(domainName);
      try {
        const res = entry.handler({
          tickSeq: this.tickSequence,
          simTimeMs: newSimTime,
          deltaMs: actualSimDelta,
          clock: this.clock,
          prng: stream
        });
        if (res !== undefined) {
          domainResults[domainName] = res;
        }
      } catch (err) {
        console.error(`❌ [SimulationEngine] Error in domain '${domainName}':`, err);
      }
    }

    const t1 = this.clock.monotonic();
    this.lastTickDurationMs = Number((t1 - t0).toFixed(3));
    this.lastTickMonotonic = t1;

    return {
      tickSequence: this.tickSequence,
      simTimeMs: newSimTime,
      simDeltaMs: actualSimDelta,
      durationMs: this.lastTickDurationMs,
      domainResults
    };
  }

  /**
   * Creates and records a deterministic event envelope in the simulation journal.
   */
  recordEvent({
    type,
    entityId = null,
    entityType = null,
    source = 'simulation',
    payload = null,
    domain = 'default',
    metadata = {}
  }) {
    this.eventSequence++;
    const simTime = this.clock.now();
    const wallTime = this.clock.wallNowIso();

    const envelope = Object.freeze({
      sequence: this.eventSequence,
      tickSequence: this.tickSequence,
      simulationTime: simTime,
      simulationTimeIso: this.clock.nowIso(),
      wallTime,
      type,
      entityId: entityId ? String(entityId) : null,
      entityType: entityType ? String(entityType) : null,
      source,
      domain,
      payload,
      metadata: {
        ...metadata,
        mode: this.clock.mode,
        speedMultiplier: this.clock.speedMultiplier
      }
    });

    this.eventJournal.push(envelope);
    if (this.eventJournal.length > this.maxJournalLength) {
      this.eventJournal.shift();
    }

    return envelope;
  }

  /**
   * Start interval loop for real-time / background advancement.
   */
  start(customIntervalMs = null) {
    if (this.isRunning) return;
    this.isRunning = true;
    const interval = customIntervalMs || this.tickResolution;
    this._intervalId = setInterval(() => {
      this.step(this.tickResolution);
    }, interval);
    if (this._intervalId.unref) this._intervalId.unref();
  }

  stop() {
    this.isRunning = false;
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  /**
   * Capture a full deterministic checkpoint for resumption / replay comparison.
   * Strips out circular or non-serializable objects (DOM, Canvas, Socket, Leaflet).
   */
  createCheckpoint(extraState = {}) {
    return {
      schemaVersion: "v19.0.0-deterministic",
      capturedAtWall: this.clock.wallNowIso(),
      tickSequence: this.tickSequence,
      eventSequence: this.eventSequence,
      clock: this.clock.getSnapshot(),
      randomRegistry: this.randomRegistry.getSnapshot(),
      extraState: JSON.parse(JSON.stringify(extraState))
    };
  }

  /**
   * Restore engine state from a checkpoint.
   */
  restoreCheckpoint(checkpoint) {
    if (!checkpoint) return;
    if (typeof checkpoint.tickSequence === 'number') this.tickSequence = checkpoint.tickSequence;
    if (typeof checkpoint.eventSequence === 'number') this.eventSequence = checkpoint.eventSequence;
    if (checkpoint.clock) this.clock.restoreSnapshot(checkpoint.clock);
    if (checkpoint.randomRegistry) this.randomRegistry.restoreSnapshot(checkpoint.randomRegistry);
    return checkpoint.extraState;
  }

  /**
   * Replay an array of deterministic events or step counts from a checkpoint.
   * @param {Object} checkpoint
   * @param {number} stepCount - Number of deterministic ticks to advance
   * @returns {Object} Final engine state after replay
   */
  replayFromCheckpoint(checkpoint, stepCount = 10) {
    this.restoreCheckpoint(checkpoint);
    const results = [];
    for (let i = 0; i < stepCount; i++) {
      results.push(this.step(this.tickResolution));
    }
    return {
      finalTickSequence: this.tickSequence,
      finalSimTime: this.clock.now(),
      stepsRun: stepCount,
      results
    };
  }
}

export const defaultSimEngine = new DeterministicSimulationEngine({
  clock: systemClock,
  randomRegistry: defaultRandomRegistry,
  tickResolution: 1000
});

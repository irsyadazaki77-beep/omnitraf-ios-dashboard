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
import { SimulationScheduler } from './simulationScheduler.js';

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
    this.tickResolution = options.tickResolution ?? 1000;
    if (!Number.isFinite(this.tickResolution) || this.tickResolution <= 0) {
      throw new TypeError('tickResolution must be a finite positive number');
    }
    this.tickSequence = 0;
    this.eventSequence = 0;
    this.domains = new Map(); // domainName -> { priority: number, handler: Function }
    this.eventJournal = []; // Monotonic deterministic event journal
    this.maxJournalLength = 500;
    this.isRunning = false;
    this._intervalId = null;
    this.lastTickMonotonic = 0;
    this.lastTickDurationMs = 0;
    this.lastErrors = [];
    this.diagnostics = options.diagnostics || null;
    this.scheduler = options.scheduler || new SimulationScheduler();
  }

  /**
   * Register a domain simulation step handler with execution priority.
   * Lower priority numbers run first.
   * e.g. Priority 10: Faults/inputs, 20: Devices, 30: Emergencies, 40: Traffic signals, 50: Metrics
   */
  registerDomain(name, priority, handler, lifecycle = {}) {
    if (typeof name !== 'string' || !name.trim()) throw new TypeError('domain name is required');
    if (typeof handler !== 'function') throw new TypeError(`handler for '${name}' must be a function`);
    if (!Number.isFinite(Number(priority))) throw new TypeError(`priority for '${name}' must be finite`);
    for (const key of ['reset', 'snapshot', 'restore']) {
      if (lifecycle[key] !== undefined && typeof lifecycle[key] !== 'function') throw new TypeError(`${key} lifecycle hook for '${name}' must be a function`);
    }
    this.domains.set(name, { priority: Number(priority), handler, lifecycle });
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

  step(customDeltaMs = null, { force = false } = {}) {
    const requestedDelta = customDeltaMs === null ? this.tickResolution : customDeltaMs;
    if (!Number.isFinite(requestedDelta) || requestedDelta <= 0) {
      throw new TypeError('simulation delta must be a finite positive number');
    }
    // A paused engine does not run domains or consume random values. Use the
    // clock's explicit force option for future/manual single-step support.
    if (this.clock.paused && !force) {
      return { tickSequence: this.tickSequence, simTimeMs: this.clock.now(), simDeltaMs: 0, durationMs: 0, domainResults: {}, paused: true };
    }
    const t0 = this.clock.monotonic();
    const deltaMs = requestedDelta;

    // 1. Advance simulation clock (accounting for pause and speed multiplier)
    const prevSimTime = this.clock.now();
    const newSimTime = this.clock.advance(deltaMs, force);
    const actualSimDelta = newSimTime - prevSimTime;

    this.tickSequence++;
    const scheduledEvents = this.scheduler.drainThrough(newSimTime);
    for (const event of scheduledEvents) {
      this.recordEvent({
        type: event.type,
        source: 'scenario',
        domain: 'scenario-scheduler',
        payload: event.payload,
        metadata: { scheduledAt: event.at, schedulerSequence: event.sequence }
      });
    }

    // 2. Sort domains deterministically by priority
    const sortedDomains = Array.from(this.domains.entries()).sort((a, b) => a[1].priority - b[1].priority || a[0].localeCompare(b[0]));

    // 3. Execute domain handlers in order
    const domainResults = {};
    this.lastErrors = [];
    for (const [domainName, entry] of sortedDomains) {
      const stream = this.randomRegistry.getStream(domainName);
      try {
        const res = entry.handler({
          tickSeq: this.tickSequence,
          simTimeMs: newSimTime,
          deltaMs: actualSimDelta,
          clock: this.clock,
          prng: stream,
          scheduledEvents
        });
        if (res !== undefined) {
          domainResults[domainName] = res;
        }
      } catch (err) {
        this._recordError(domainName, err);
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
    if (typeof type !== 'string' || !type.trim()) throw new TypeError('simulation event type is required');
    const stablePayload = serializeSnapshot(payload);
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
      payload: stablePayload,
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
    const interval = customIntervalMs ?? this.tickResolution;
    if (!Number.isFinite(interval) || interval <= 0) throw new TypeError('interval must be a finite positive number');
    this.isRunning = true;
    this._intervalId = setInterval(() => {
      try { this.step(this.tickResolution); }
      catch (err) {
        this.lastErrors = [];
        this._recordError('engine', err);
      }
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

  scheduleEvent(at, type, payload = null) { return this.scheduler.schedule(at, type, payload); }

  pause() { this.clock.pause(); return this; }
  resume() { this.clock.resume(); return this; }

  reset({ startTime = this.clock.startTime, seed = this.randomRegistry.masterSeed } = {}) {
    if (!Number.isFinite(startTime)) throw new TypeError('startTime must be finite');
    this.stop();
    this.clock.reset(startTime);
    this.randomRegistry.resetAll(seed);
    this.tickSequence = 0;
    this.eventSequence = 0;
    this.eventJournal.length = 0;
    this.scheduler.clear();
    this.lastErrors = [];
    for (const [name, domain] of this.domains) {
      try { domain.lifecycle.reset?.({ clock: this.clock, rng: this.randomRegistry.getStream(name) }); }
      catch (error) { this._recordError(name, error); }
    }
    this.lastTickDurationMs = 0;
    this.lastTickMonotonic = 0;
    return this;
  }

  getDiagnostics() {
    return Object.freeze({
      running: this.isRunning,
      paused: this.clock.paused,
      simulationTimeMs: this.clock.now(),
      speedMultiplier: this.clock.speedMultiplier,
      seed: this.randomRegistry.masterSeed,
      tickSequence: this.tickSequence,
      eventSequence: this.eventSequence,
      eventQueueSize: this.scheduler.size,
      activeModules: Array.from(this.domains.keys()).sort(),
      lastEventType: this.eventJournal.at(-1)?.type || null,
      lastTickDurationMs: this.lastTickDurationMs,
      health: this.lastErrors.length ? 'degraded' : 'healthy',
      errors: this.lastErrors.slice()
    });
  }

  _recordError(domain, error) {
    const diagnostic = { domain, tickSequence: this.tickSequence, message: error?.message || String(error) };
    this.lastErrors.push(diagnostic);
    if (typeof this.diagnostics === 'function') {
      try { this.diagnostics(diagnostic); } catch { /* diagnostics must not break simulation */ }
    }
  }

  /**
   * Capture a full deterministic checkpoint for resumption / replay comparison.
   * Strips out circular or non-serializable objects (DOM, Canvas, Socket, Leaflet).
   */
  createCheckpoint(extraState = {}) {
    const domains = {};
    for (const [name, domain] of this.domains) {
      if (domain.lifecycle.snapshot) domains[name] = domain.lifecycle.snapshot();
    }
    return {
      schemaVersion: "v19.0.0-deterministic",
      capturedAtWall: this.clock.wallNowIso(),
      tickSequence: this.tickSequence,
      eventSequence: this.eventSequence,
      clock: this.clock.getSnapshot(),
      randomRegistry: this.randomRegistry.getSnapshot(),
      scheduler: this.scheduler.getSnapshot(),
      domains: serializeSnapshot(domains),
      extraState: serializeSnapshot(extraState)
    };
  }

  /**
   * Restore engine state from a checkpoint.
   */
  restoreCheckpoint(checkpoint) {
    if (!checkpoint || typeof checkpoint !== 'object' || !Number.isSafeInteger(checkpoint.tickSequence) || checkpoint.tickSequence < 0 || !Number.isSafeInteger(checkpoint.eventSequence) || checkpoint.eventSequence < 0 || !checkpoint.clock || !checkpoint.randomRegistry || !checkpoint.scheduler) {
      throw new TypeError('invalid simulation checkpoint');
    }
    const clockValidator = new UnifiedClock({ mode: checkpoint.clock.mode, startTime: checkpoint.clock.startTime, speedMultiplier: checkpoint.clock.speedMultiplier, paused: checkpoint.clock.paused, timezone: checkpoint.clock.timezone });
    clockValidator.restoreSnapshot(checkpoint.clock);
    const randomValidator = new DeterministicRandomRegistry(checkpoint.randomRegistry.masterSeed);
    randomValidator.restoreSnapshot(checkpoint.randomRegistry);
    const schedulerValidator = new SimulationScheduler();
    schedulerValidator.restoreSnapshot(checkpoint.scheduler);
    const domainSnapshots = deserializeSnapshot(checkpoint.domains || {});
    if (!domainSnapshots || typeof domainSnapshots !== 'object' || Array.isArray(domainSnapshots)) throw new TypeError('invalid simulation domain snapshots');
    for (const name of Object.keys(domainSnapshots)) {
      if (!this.domains.get(name)?.lifecycle.restore) throw new TypeError(`checkpoint requires unavailable domain '${name}'`);
    }
    const extraState = deserializeSnapshot(checkpoint.extraState);

    this.clock.restoreSnapshot(checkpoint.clock);
    this.randomRegistry.restoreSnapshot(checkpoint.randomRegistry);
    this.scheduler.restoreSnapshot(checkpoint.scheduler);
    this.tickSequence = checkpoint.tickSequence;
    this.eventSequence = checkpoint.eventSequence;
    for (const [name, snapshot] of Object.entries(domainSnapshots)) {
      const domain = this.domains.get(name);
      domain.lifecycle.restore(snapshot);
    }
    return extraState;
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

function serializeSnapshot(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Map
    ? { __simulationType: 'Map', entries: Array.from(item.entries()) }
    : item));
}

function deserializeSnapshot(value) {
  return JSON.parse(JSON.stringify(value), (_key, item) => item && item.__simulationType === 'Map'
    ? new Map(item.entries)
    : item);
}

export const defaultSimEngine = new DeterministicSimulationEngine({
  clock: systemClock,
  randomRegistry: defaultRandomRegistry,
  tickResolution: 1000
});

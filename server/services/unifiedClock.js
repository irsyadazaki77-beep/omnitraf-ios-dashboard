/**
 * OmniTRAF Surabaya - Unified Time Abstraction (Phase 19)
 * 
 * Provides distinct clocks:
 * 1. Wall Clock: Actual real-world time for display, audit logging, and external system sync.
 * 2. Monotonic Clock: Nanosecond/millisecond duration measurement immune to NTP jumps or system clock adjustments.
 * 3. Simulation Clock: Virtual progression clock for deterministic simulations (traffic cycles, emergency ETA, device heartbeat, predictions).
 * 
 * Supports modes:
 * - 'LIVE': Realtime simulation, simulation clock steps along with wall clock or tick delta.
 * - 'SIMULATED': Controlled simulation time, advanceable explicitly or at configurable speedMultiplier.
 * - 'REPLAY': Deterministic playback from sequenced events or recorded states.
 * - 'TEST': Injected fake clock where time only moves when manually advanced.
 */

export const SIMULATION_MODES = Object.freeze({
  LIVE: 'LIVE',
  SIMULATED: 'SIMULATED',
  REPLAY: 'REPLAY',
  TEST: 'TEST'
});

export class UnifiedClock {
  /**
   * @param {Object} options
   * @param {string} [options.mode='LIVE'] - LIVE | SIMULATED | REPLAY | TEST
   * @param {number} [options.startTime] - Starting timestamp in milliseconds (defaults to Date.now())
   * @param {number} [options.speedMultiplier=1.0] - Time scale multiplier
   * @param {boolean} [options.paused=false] - Whether simulation clock is paused
   * @param {string} [options.timezone='Asia/Jakarta']
   */
  constructor(options = {}) {
    this.mode = options.mode || SIMULATION_MODES.LIVE;
    this.startTime = typeof options.startTime === 'number' ? options.startTime : Date.now();
    this.simTimeMs = this.startTime;
    this.speedMultiplier = typeof options.speedMultiplier === 'number' && options.speedMultiplier > 0 ? options.speedMultiplier : 1.0;
    this.paused = !!options.paused;
    this.timezone = options.timezone || 'Asia/Jakarta';

    // Internal reference point for monotonic duration calculations
    this._monotonicOrigin = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : (typeof process !== 'undefined' && process.hrtime ? Number(process.hrtime.bigint()) / 1e6 : Date.now());
    this._lastRealWallMs = Date.now();
  }

  // ==========================================
  // 1. WALL CLOCK (Real-world display/audit)
  // ==========================================

  /**
   * Current real wall time in epoch milliseconds.
   */
  wallNow() {
    return Date.now();
  }

  /**
   * Current real wall time in ISO 8601 string.
   */
  wallNowIso() {
    return new Date().toISOString();
  }

  /**
   * Formatted WIB string for real wall time.
   */
  wallNowWibString() {
    try {
      return new Date().toLocaleTimeString('id-ID', {
        timeZone: this.timezone,
        hour12: false
      }) + ' WIB';
    } catch (_) {
      const d = new Date(Date.now() + 7 * 3600 * 1000);
      return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')} WIB`;
    }
  }

  // ==========================================
  // 2. MONOTONIC CLOCK (Duration & profiling)
  // ==========================================

  /**
   * Monotonic high-resolution timestamp in milliseconds.
   * Guaranteed to never jump backward even if system clock changes.
   */
  monotonic() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    if (typeof process !== 'undefined' && process.hrtime && typeof process.hrtime.bigint === 'function') {
      return Number(process.hrtime.bigint()) / 1e6;
    }
    return Date.now() - this._monotonicOrigin;
  }

  /**
   * Elapsed monotonic time in milliseconds since a previous monotonic mark.
   */
  elapsedMonotonic(sinceMark) {
    return Math.max(0, this.monotonic() - (sinceMark || 0));
  }

  // ==========================================
  // 3. SIMULATION CLOCK (Domain state progression)
  // ==========================================

  /**
   * Current simulation time in milliseconds.
   */
  now() {
    return this.simTimeMs;
  }

  /**
   * Current simulation time in ISO 8601 format.
   */
  nowIso() {
    return new Date(this.simTimeMs).toISOString();
  }

  /**
   * Formatted WIB string for simulation clock.
   */
  nowWibString() {
    try {
      return new Date(this.simTimeMs).toLocaleTimeString('id-ID', {
        timeZone: this.timezone,
        hour12: false
      }) + ' WIB';
    } catch (_) {
      const d = new Date(this.simTimeMs + 7 * 3600 * 1000);
      return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')} WIB`;
    }
  }

  /**
   * Advance simulation clock by a delta in milliseconds.
   * If clock is paused, advance is skipped unless force is true (used in manual step).
   * @param {number} deltaMs
   * @param {boolean} [force=false]
   * @returns {number} New simulation timestamp in milliseconds
   */
  advance(deltaMs, force = false) {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      throw new TypeError('simulation delta must be a finite non-negative number');
    }
    if (this.paused && !force) {
      return this.simTimeMs;
    }
    const scaledDelta = deltaMs * (this.mode === SIMULATION_MODES.TEST ? 1.0 : this.speedMultiplier);
    this.simTimeMs += Math.round(scaledDelta);
    return this.simTimeMs;
  }

  /**
   * Jump or set simulation clock to an explicit timestamp.
   * @param {number} targetMs
   */
  setTime(targetMs) {
    if (!Number.isFinite(targetMs)) throw new TypeError('simulation time must be finite');
    this.simTimeMs = Math.round(targetMs);
    return this.simTimeMs;
  }

  reset(startTime = this.startTime) {
    if (!Number.isFinite(startTime)) throw new TypeError('startTime must be finite');
    this.startTime = Math.round(startTime);
    this.simTimeMs = this.startTime;
    this.paused = false;
    return this;
  }

  /**
   * Elapsed simulation time in milliseconds since a recorded simulation timestamp.
   */
  elapsedSince(simTimestampMs) {
    return Math.max(0, this.simTimeMs - (simTimestampMs || this.startTime));
  }

  /**
   * Pause simulation clock.
   */
  pause() {
    this.paused = true;
    return this;
  }

  /**
   * Resume simulation clock.
   */
  resume() {
    this.paused = false;
    this._lastRealWallMs = Date.now();
    return this;
  }

  /**
   * Set speed multiplier (e.g. 1.0, 2.0, 4.0).
   */
  setSpeedMultiplier(multiplier) {
    if (typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier <= 0) throw new TypeError('speed multiplier must be finite and positive');
    this.speedMultiplier = multiplier;
    return this.speedMultiplier;
  }

  /**
   * Switch mode (LIVE, SIMULATED, REPLAY, TEST).
   */
  setMode(mode) {
    if (!Object.values(SIMULATION_MODES).includes(mode)) throw new TypeError(`invalid simulation mode '${mode}'`);
    this.mode = mode;
    return this.mode;
  }

  /**
   * Capture a lightweight snapshot of clock state.
   */
  getSnapshot() {
    return {
      mode: this.mode,
      startTime: this.startTime,
      simTimeMs: this.simTimeMs,
      iso: this.nowIso(),
      wib: this.nowWibString(),
      speedMultiplier: this.speedMultiplier,
      paused: this.paused,
      timezone: this.timezone
    };
  }

  /**
   * Restore clock state from snapshot.
   */
  restoreSnapshot(snapshot) {
    if (!snapshot) return;
    if (!Number.isFinite(snapshot.startTime) || !Number.isFinite(snapshot.simTimeMs) || !Number.isFinite(snapshot.speedMultiplier) || snapshot.speedMultiplier <= 0 || !Object.values(SIMULATION_MODES).includes(snapshot.mode) || typeof snapshot.paused !== 'boolean' || typeof snapshot.timezone !== 'string') {
      throw new TypeError('invalid simulation clock snapshot');
    }
    if (snapshot.mode) this.mode = snapshot.mode;
    if (typeof snapshot.startTime === 'number') this.startTime = snapshot.startTime;
    if (typeof snapshot.simTimeMs === 'number') this.simTimeMs = snapshot.simTimeMs;
    if (typeof snapshot.speedMultiplier === 'number') this.speedMultiplier = snapshot.speedMultiplier;
    if (typeof snapshot.paused === 'boolean') this.paused = snapshot.paused;
    if (snapshot.timezone) this.timezone = snapshot.timezone;
  }
}

// Global default clock instance (LIVE mode by default, Asia/Jakarta)
export const systemClock = new UnifiedClock();

/** Scenario lifecycle adapter. Definitions are data; domain changes remain in registered modules. */
export class ScenarioRunner {
  constructor({ engine, registry, applyInitialState = null } = {}) {
    if (!engine || typeof engine.step !== 'function') throw new TypeError('scenario runner requires a simulation engine');
    if (!registry || typeof registry.get !== 'function') throw new TypeError('scenario runner requires a scenario registry');
    if (applyInitialState !== null && typeof applyInitialState !== 'function') throw new TypeError('applyInitialState must be a function');
    this.engine = engine;
    this.registry = registry;
    this.applyInitialState = applyInitialState;
    this.active = null;
    this.status = 'idle';
    this.baselineCheckpoint = null;
  }

  start(id) {
    const scenario = this.registry.get(id);
    if (!scenario) throw new RangeError(`unknown scenario '${id}'`);
    if (this.status === 'running') throw new Error('a scenario is already running');
    if (scenario.initialState !== undefined && !this.applyInitialState) throw new Error('scenario initialState requires an applyInitialState adapter');
    this.baselineCheckpoint = this.engine.createCheckpoint();
    try {
      this.engine.reset({ startTime: scenario.startTime, seed: scenario.seed });
      if (scenario.initialState !== undefined) this.applyInitialState(scenario.initialState);
    } catch (error) {
      this.engine.restoreCheckpoint(this.baselineCheckpoint);
      this.baselineCheckpoint = null;
      throw error;
    }
    this.active = scenario;
    this.status = 'running';
    for (const event of scenario.events) this.engine.scheduleEvent(scenario.startTime + event.at, event.type, event.payload);
    return this.getSnapshot();
  }

  step(deltaMs = this.engine.tickResolution) {
    if (this.status === 'paused') return { ...this.engine.step(deltaMs), scenarioStatus: this.status };
    if (this.status !== 'running') throw new Error('no running scenario');
    const result = this.engine.step(deltaMs);
    if (!result.paused && result.simTimeMs >= this.active.startTime + this.active.durationMs) {
      this.engine.pause();
      this.status = 'completed';
    }
    return { ...result, scenarioStatus: this.status };
  }

  pause() {
    if (this.status !== 'running') return this.getSnapshot();
    this.engine.pause();
    this.status = 'paused';
    return this.getSnapshot();
  }

  resume() {
    if (this.status !== 'paused') return this.getSnapshot();
    this.engine.resume();
    this.status = 'running';
    return this.getSnapshot();
  }

  reset() {
    if (this.baselineCheckpoint) this.engine.restoreCheckpoint(this.baselineCheckpoint);
    this.active = null;
    this.status = 'idle';
    this.baselineCheckpoint = null;
    return this.getSnapshot();
  }

  getSnapshot() {
    return Object.freeze({ status: this.status, scenarioId: this.active?.id || null, simulationTimeMs: this.engine.clock.now(), seed: this.active?.seed ?? null, durationMs: this.active?.durationMs ?? null });
  }
}

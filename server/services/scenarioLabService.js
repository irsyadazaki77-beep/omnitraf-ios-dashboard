import { randomUUID } from 'node:crypto';
import { ScenarioRegistry } from './scenarioRegistry.js';
import { ScenarioRunner } from './scenarioRunner.js';
import { UnifiedClock, SIMULATION_MODES } from './unifiedClock.js';
import { DeterministicRandomRegistry } from './seededRandom.js';
import { DeterministicSimulationEngine } from './simulationEngine.js';
import { simulateTrafficNetwork } from '../../src/modules/trafficModel.js';
import { CORRIDORS_CONFIG } from '../../src/modules/forecastEngine.js';

const SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_SESSIONS_PER_USER = 3;
const LEVELS = new Set(['none', 'low', 'medium', 'high', 'critical']);
const STRATEGIES = new Set(['fixed', 'adaptive', 'emergency-green-wave']);
const PRESETS = Object.freeze([
  { id: 'normal', name: 'Normal Traffic', description: 'Arus dasar dan sinyal tetap.', config: { demandMultiplier: 1, weather: 'clear', incidentSeverity: 'none', signalStrategy: 'fixed' } },
  { id: 'rush-hour', name: 'Rush Hour', description: 'Permintaan mengikuti pengali jam sibuk model.', config: { demandMultiplier: 1.45, weather: 'clear', incidentSeverity: 'none', signalStrategy: 'fixed' } },
  { id: 'heavy-rain', name: 'Heavy Rain', description: 'Hujan mengubah kapasitas dan kecepatan model.', config: { demandMultiplier: 1, weather: 'rain', incidentSeverity: 'none', signalStrategy: 'fixed' } },
  { id: 'major-incident', name: 'Major Incident', description: 'Insiden kritis dimulai di tengah horizon.', config: { demandMultiplier: 1, weather: 'clear', incidentSeverity: 'critical', signalStrategy: 'fixed' } },
  { id: 'road-closure', name: 'Road Closure', description: 'Penutupan jalur arteri dengan reduksi kapasitas tinggi.', config: { demandMultiplier: 0.9, weather: 'clear', incidentSeverity: 'critical', signalStrategy: 'fixed' } },
  { id: 'adaptive-signals', name: 'Adaptive Signals', description: 'Pembagian hijau adaptif pada koridor model.', config: { demandMultiplier: 1, weather: 'clear', incidentSeverity: 'none', signalStrategy: 'adaptive' } },
  { id: 'emergency-green-wave', name: 'Emergency Green Wave', description: 'Relief model untuk koridor prioritas darurat.', config: { demandMultiplier: 1, weather: 'clear', incidentSeverity: 'none', signalStrategy: 'emergency-green-wave' } }
]);

function fail(message, status = 422, code = 'INVALID_SCENARIO') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

export function normalizeLabConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('scenario config must be an object');
  const seed = input.seed === undefined ? 42 : Number(input.seed);
  const hour = input.hour === undefined ? 8 : Number(input.hour);
  const horizonMinutes = input.horizonMinutes === undefined ? 30 : Number(input.horizonMinutes);
  const demandMultiplier = input.demandMultiplier === undefined ? 1 : Number(input.demandMultiplier);
  const corridorId = input.corridorId || 'all';
  const weather = input.weather || 'clear';
  const incidentSeverity = input.incidentSeverity || 'none';
  const signalStrategy = input.signalStrategy || 'fixed';
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647) fail('seed must be an integer from 0 to 2147483647');
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) fail('hour must be an integer from 0 to 23');
  if (!Number.isInteger(horizonMinutes) || horizonMinutes < 1 || horizonMinutes > 120) fail('horizonMinutes must be an integer from 1 to 120');
  if (!Number.isFinite(demandMultiplier) || demandMultiplier < 0.5 || demandMultiplier > 1.75) fail('demandMultiplier must be from 0.5 to 1.75');
  if (corridorId !== 'all' && !CORRIDORS_CONFIG.some(item => item.id === corridorId)) fail('corridorId is not supported');
  if (!['clear', 'rain'].includes(weather)) fail('weather must be clear or rain');
  if (!LEVELS.has(incidentSeverity)) fail('incidentSeverity is not supported');
  if (!STRATEGIES.has(signalStrategy)) fail('signalStrategy is not supported');
  return { seed, hour, horizonMinutes, demandMultiplier, corridorId, weather, incidentSeverity, signalStrategy };
}

function toModelOptions(config, incidentSeverity = config.incidentSeverity) {
  const target = CORRIDORS_CONFIG.find(item => item.id === config.corridorId);
  const incidents = incidentSeverity === 'none' ? [] : [{
    id: 'scenario-lab-incident', title: 'Scenario Lab incident', location: target?.name || 'A. Yani / Wonokromo',
    corridorId: target?.id, severity: incidentSeverity, status: 'ACTIVE'
  }];
  const strategy = config.signalStrategy;
  const isScoped = Boolean(target);
  return {
    seed: config.seed, hour: config.hour, horizonMinutes: config.horizonMinutes,
    rushHour: !isScoped && config.demandMultiplier === 1.45,
    demandMultiplier: isScoped ? 1 : config.demandMultiplier,
    corridorDemandMultipliers: target ? { [target.id]: config.demandMultiplier } : {},
    rain: config.weather === 'rain', incidents,
    signalControl: strategy === 'adaptive' ? 'adaptive' : 'fixed',
    emergencyGreenWave: strategy === 'emergency-green-wave', greenWave: strategy === 'emergency-green-wave'
  };
}

function localStartTime(hour) {
  // Stable simulation calendar day at the selected Asia/Jakarta hour.
  return Date.UTC(2025, 0, 1, hour) - 7 * 60 * 60 * 1000;
}

function cloneState(state) { return JSON.parse(JSON.stringify(state || {})); }

function metricSummary(metrics) {
  return Object.fromEntries(['demandVehPerHour', 'throughputVehPerHour', 'averageSpeedKmh', 'averageTravelTimeMinutes', 'queueMeters', 'congestionIndex', 'queueConservationResidual'].map(key => [key, metrics[key]]));
}

export class ScenarioLabService {
  constructor({ getState } = {}) {
    if (typeof getState !== 'function') throw new TypeError('scenario lab service requires a state snapshot provider');
    this.getState = getState;
    this.sessions = new Map();
  }

  listPresets() {
    return { presets: PRESETS, corridors: CORRIDORS_CONFIG.map(({ id, name }) => ({ id, name })) };
  }

  compare({ baseline, alternative, seed, hour, horizonMinutes, corridorId = 'all' } = {}) {
    const common = normalizeLabConfig({ seed, hour, horizonMinutes, corridorId });
    const baselineConfig = normalizeLabConfig({ ...common, ...(PRESETS.find(p => p.id === baseline)?.config || {}) , seed: common.seed, hour: common.hour, horizonMinutes: common.horizonMinutes, corridorId: common.corridorId });
    const alternativePreset = PRESETS.find(p => p.id === alternative);
    if (!alternativePreset) fail('unknown comparison preset');
    if (!PRESETS.some(p => p.id === baseline)) fail('unknown baseline preset');
    const alternativeConfig = normalizeLabConfig({ ...common, ...alternativePreset.config, seed: common.seed, hour: common.hour, horizonMinutes: common.horizonMinutes, corridorId: common.corridorId });
    const state = cloneState(this.getState());
    const baselineMetrics = simulateTrafficNetwork(state, { ...toModelOptions(baselineConfig), initialQueues: undefined });
    const alternativeMetrics = simulateTrafficNetwork(state, { ...toModelOptions(alternativeConfig), initialQueues: undefined });
    return {
      seed: common.seed, hour: common.hour, horizonMinutes: common.horizonMinutes,
      sameInitialState: true,
      initialStateVersion: state.stateVersion ?? state.seq ?? null,
      baseline: { id: baseline, name: PRESETS.find(p => p.id === baseline).name, metrics: metricSummary(baselineMetrics), corridors: baselineMetrics.corridors },
      alternative: { id: alternative, name: alternativePreset.name, metrics: metricSummary(alternativeMetrics), corridors: alternativeMetrics.corridors },
      delta: Object.fromEntries(['averageSpeedKmh', 'averageTravelTimeMinutes', 'queueMeters', 'congestionIndex', 'throughputVehPerHour'].map(key => [key, Number((alternativeMetrics[key] - baselineMetrics[key]).toFixed(2))])),
      assumptions: baselineMetrics.assumptions, provenance: 'SIMULATED'
    };
  }

  create(userId, rawConfig) {
    this._prune();
    const owned = [...this.sessions.values()].filter(session => session.userId === userId);
    if (owned.length >= MAX_SESSIONS_PER_USER) fail(`maximum ${MAX_SESSIONS_PER_USER} active Scenario Lab sessions`, 429, 'SCENARIO_SESSION_LIMIT');
    const config = normalizeLabConfig(rawConfig);
    const initialState = cloneState(this.getState());
    const startTime = localStartTime(config.hour);
    const context = { initialState, config, runtimeIncidentSeverity: 'none', metrics: null, timeline: [], markers: [] };
    const clock = new UnifiedClock({ mode: SIMULATION_MODES.TEST, startTime, timezone: 'Asia/Jakarta' });
    const randomRegistry = new DeterministicRandomRegistry(config.seed);
    const engine = new DeterministicSimulationEngine({ clock, randomRegistry, tickResolution: 60_000 });
    engine.registerDomain('traffic-model', 50, ({ simTimeMs, scheduledEvents }) => {
      for (const event of scheduledEvents) {
        if (event.type === 'scenario.incident.started') {
          context.runtimeIncidentSeverity = event.payload.severity;
          context.markers.push({ minute: Math.round((simTimeMs - startTime) / 60_000), type: 'incident', label: `Insiden ${event.payload.severity}` });
        }
      }
      const elapsedMinutes = Math.max(0, Math.round((simTimeMs - startTime) / 60_000));
      const hour = (config.hour + Math.floor(elapsedMinutes / 60)) % 24;
      const options = toModelOptions({ ...config, hour }, context.runtimeIncidentSeverity);
      context.metrics = simulateTrafficNetwork(context.initialState, options);
      context.timeline.push({ minute: elapsedMinutes, ...metricSummary(context.metrics) });
      return context.metrics;
    }, {
      snapshot: () => ({ runtimeIncidentSeverity: context.runtimeIncidentSeverity, metrics: context.metrics, timeline: context.timeline, markers: context.markers }),
      restore: snapshot => { context.runtimeIncidentSeverity = snapshot.runtimeIncidentSeverity; context.metrics = snapshot.metrics; context.timeline = snapshot.timeline || []; context.markers = snapshot.markers || []; },
      reset: () => { context.runtimeIncidentSeverity = 'none'; context.metrics = null; context.timeline = []; context.markers = []; }
    });
    const incidentAt = config.incidentSeverity === 'none' ? null : Math.max(0, Math.floor(config.horizonMinutes / 2));
    const id = randomUUID();
    const definition = {
      id: `lab-${id}`, name: 'Scenario Lab run', seed: config.seed, startTime, durationMs: config.horizonMinutes * 60_000,
      events: incidentAt === null ? [] : [{ at: incidentAt * 60_000, type: 'scenario.incident.started', payload: { severity: config.incidentSeverity } }],
      initialState: config
    };
    const registry = new ScenarioRegistry([definition]);
    const runner = new ScenarioRunner({ engine, registry, applyInitialState: data => { context.config = normalizeLabConfig(data); } });
    const session = { id, userId, config, initialStateVersion: initialState.stateVersion ?? initialState.seq ?? null, initialState, context, startTime, runner, createdAt: Date.now(), updatedAt: Date.now() };
    this.sessions.set(id, session);
    return this.snapshot(id, userId);
  }

  control(id, userId, action) {
    const session = this._get(id, userId);
    if (action === 'play') {
      if (session.runner.status === 'idle' || session.runner.status === 'completed') session.runner.start(`lab-${id}`);
      else session.runner.resume();
    } else if (action === 'pause') session.runner.pause();
    else if (action === 'step') {
      if (session.runner.status === 'idle') fail('start the scenario before stepping', 409, 'SCENARIO_NOT_STARTED');
      session.runner.step(60_000);
    } else if (action === 'reset') session.runner.reset();
    else if (action === 'replay') {
      session.runner.reset();
      session.runner.start(`lab-${id}`);
    } else fail('control action must be play, pause, step, reset, or replay');
    session.updatedAt = Date.now();
    return this.snapshot(id, userId);
  }

  snapshot(id, userId) {
    const session = this._get(id, userId);
    const status = session.runner.getSnapshot();
    const elapsedMinutes = Math.max(0, Math.min(session.config.horizonMinutes, Math.floor((status.simulationTimeMs - session.startTime) / 60_000)));
    const metrics = session.context.metrics;
    return {
      id, config: session.config, status: status.status, elapsedMinutes, progress: Math.round(elapsedMinutes / session.config.horizonMinutes * 100),
      metrics: metrics ? metricSummary(metrics) : null, corridors: metrics?.corridors || [],
      timeline: session.context.timeline, markers: session.context.markers,
      modelScenario: metrics?.scenario || null,
      initialStateVersion: session.initialStateVersion, isolated: true, provenance: 'SIMULATED',
      assumptions: metrics?.assumptions || []
    };
  }

  remove(id, userId) {
    const session = this._get(id, userId);
    session.runner.reset();
    this.sessions.delete(id);
  }

  _get(id, userId) {
    const session = this.sessions.get(id);
    if (!session || session.userId !== userId) fail('Scenario Lab session not found', 404, 'SCENARIO_SESSION_NOT_FOUND');
    session.updatedAt = Date.now();
    return session;
  }

  _prune() {
    const now = Date.now();
    for (const [id, session] of this.sessions) if (now - session.updatedAt > SESSION_TTL_MS) {
      session.runner.reset();
      this.sessions.delete(id);
    }
  }
}


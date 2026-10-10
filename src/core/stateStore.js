/**
 * OmniTRAF Surabaya - Unified State Store & Event Architecture (Phase 1)
 * Single Source of Truth untuk seluruh state frontend & jembatan sinkronisasi data backend/local.
 *
 * Fitur:
 * - Skema state terdefinisi & terstruktur
 * - Immutable-safe snapshot (deep clone + deep freeze)
 * - Safe nested updates & functional updater
 * - Standardized Event Envelope { type, timestamp, source, version, payload }
 * - Backward compatibility untuk event subscriber eksisting
 * - Memory leak guard (Set-based deduplication & cleanup)
 * - Helper aksi terpusat (updateTrafficState, updateSignalState, dll.)
 */

import { TRAFFIC_LIMITS } from '../config/trafficConfig.js';
import { diagnostics } from './diagnostics.js';
import { shallowEqual } from './state/comparators.js';
import { eventBus, createEventEnvelope } from './eventBus.js';
import { smartUpdateDOM, flushPendingDomWrites, clearPendingDomWrites } from './domScheduler.js';
import {
  normalizeCanonicalTelemetry,
  normalizeCanonicalIntersection,
  normalizeCanonicalDevice,
  normalizeCanonicalIncident,
  normalizeCanonicalEmergency,
  createNormalizedCollection,
  CompatibilityAdapters
} from '../config/domainModels.js';

export {
  normalizeCanonicalTelemetry,
  normalizeCanonicalIntersection,
  normalizeCanonicalDevice,
  normalizeCanonicalIncident,
  normalizeCanonicalEmergency,
  createNormalizedCollection,
  CompatibilityAdapters
};

// Re-export eventBus and domScheduler utilities for backward compatibility
export { eventBus, createEventEnvelope };
export { smartUpdateDOM, flushPendingDomWrites, clearPendingDomWrites };
export { shallowEqual };

/**
 * HTML Escaper Utility for Safe DOM Rendering (Phase 9 Security)
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Deep clone utility yang aman untuk objek JSON murni
 */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  const copy = {};
  for (const key of Object.keys(obj)) {
    copy[key] = deepClone(obj[key]);
  }
  return copy;
}

/**
 * Deep freeze utility untuk mencegah mutasi state yang tidak disengaja
 */
export function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  Object.keys(obj).forEach(key => {
    if (typeof obj[key] === 'object' && obj[key] !== null && !Object.isFrozen(obj[key])) {
      deepFreeze(obj[key]);
    }
  });
  return obj;
}


/**
 * Struktur State Baku (Initial Schema)
 */
export const INITIAL_STATE = {
  // Navigation & Shell
  currentView: "dashboard",
  theme: "dark",
  isSirenMuted: false,

  // Connection & Synchronization Metadata (Phase 2 Master Architecture)
  sseConnected: false,
  connectionStatus: "connecting", // 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'resyncing' | 'fallback'
  lastConnectedAt: null,
  lastDisconnectedAt: null,
  lastTelemetryAt: null,
  lastTelemetryTime: null,
  connectionAttemptCount: 0,
  isStaleData: false,
  lastReceivedSequence: 0,
  lastReceivedCctvSequence: 0,
  lastReceivedIncidentSequence: 0,
  lastReceivedEmergencySequence: 0,
  lastReceivedSignalSequence: 0,
  lastReceivedDeviceSequence: 0,
  lastTelemetrySource: null,
  stateVersion: 1,
  lastUpdated: new Date().toISOString(),

  // Traffic Controls & Modes
  isChaosMode: false,
  chaosLevel: 0,
  greenWaveActive: false,
  greenSplitWonokromo: TRAFFIC_LIMITS.DEFAULT_GREEN_SPLIT || 35,
  emergency112Active: false,
  isRainMode: false,
  roadCondition: "dry", // 'dry' | 'wet'
  activeIncidentFilter: "all",

  // CCTV & Computer Vision
  cctvPaused: false,
  cctvBoxesVisible: true,
  activeCamId: "cctvCanvas1",
  cctvVisionData: {},

  // Telemetry Aggregations
  telemetry: {
    timestamp: "--:--:-- WIB",
    networkLoad: 72,
    avgWaitTime: 42,
    congestionIndex: 62,
    co2SavedKg: 1420,
    fuelSavedLiters: 580,
    vehiclesToday: 128540,
    sitsUptime: 99.4,
    cctvOnline: 184,
    iotOnline: 312,
    sitsSignal: 94,
    aiScore: 92,
    aiConfidence: 96
  },

  // Intersections APILL
  intersections: [
    { id: "node-wonokromo", name: "Simpang Wonokromo", state: "green", timer: 35, greenSplit: 35, waitTime: 42, status: "Normal" },
    { id: "node-jemursari", name: "Simpang Jemursari", state: "red", timer: 25, greenSplit: 28, waitTime: 36, status: "Lancar" },
    { id: "node-darmo", name: "Simpang Raya Darmo", state: "green", timer: 28, greenSplit: 42, waitTime: 28, status: "Lancar" },
    { id: "node-tunjungan", name: "Simpang Tunjungan", state: "yellow", timer: 3, greenSplit: 30, waitTime: 48, status: "Padat" },
    { id: "node-merr", name: "Simpang MERR Kertajaya", state: "green", timer: 45, greenSplit: 45, waitTime: 22, status: "Lancar" }
  ],

  // Incidents
  incidents: [
    { id: "101", title: "Mogok Truk Treler", location: "Simpang Wonokromo (DTC)", status: "ACTIVE", severity: "danger", category: "accident" },
    { id: "102", title: "Genangan Air Hujan (15cm)", location: "Koridor Manyar Kertoarjo", status: "ACTIVE", severity: "warning", category: "weather" },
    { id: "103", title: "Antrean Lampu Merah Pajang", location: "Simpang Jemursari - A. Yani", status: "ACTIVE", severity: "warning", category: "congestion" }
  ],

  // Active Emergency Requests
  activeEmergencies: [
    { id: "EMG-101", code: "AMB-01", route: "route-soetomo", vehicle: "Ambulans RSU Dr. Soetomo", status: "PRIORITAS AKTIF", timestamp: "" }
  ],

  // IoT Devices
  devices: [
    {
      deviceId: "NODE-EDGE-01",
      deviceName: "Jl. Ahmad Yani (Wonokromo) Node AI",
      type: "Jetson Orin Nano",
      location: "Jl. Ahmad Yani (Wonokromo)",
      coordinates: [-7.2985, 112.7345],
      status: "ONLINE",
      lastSeenAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
      latencyMs: 12,
      packetLossPercent: 0,
      fps: 28,
      resolution: "1080p",
      temperatureC: 42,
      cpuPercent: 48,
      memoryPercent: 45,
      uptimePercent: 99.8,
      firmwareVersion: "v1.2.4-sits",
      streamStatus: "ONLINE",
      greenWaveSync: true,
      errorCount: 0,
      consecutiveFailures: 0,
      healthScore: 100,
      healthLevel: "HEALTHY",
      updatedAt: new Date().toISOString(),
      source: "REALTIME-DERIVED",
      history: [12, 11, 14, 10, 13, 12, 12, 11, 13, 12]
    },
    {
      deviceId: "NODE-EDGE-02",
      deviceName: "Jl. Raya Darmo (Taman Bungkul) Node AI",
      type: "Jetson Orin Nano",
      location: "Jl. Raya Darmo (Taman Bungkul)",
      coordinates: [-7.2810, 112.7395],
      status: "ONLINE",
      lastSeenAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
      latencyMs: 14,
      packetLossPercent: 0,
      fps: 29,
      resolution: "1080p",
      temperatureC: 45,
      cpuPercent: 52,
      memoryPercent: 49,
      uptimePercent: 99.7,
      firmwareVersion: "v1.2.4-sits",
      streamStatus: "ONLINE",
      greenWaveSync: true,
      errorCount: 0,
      consecutiveFailures: 0,
      healthScore: 100,
      healthLevel: "HEALTHY",
      updatedAt: new Date().toISOString(),
      source: "REALTIME-DERIVED",
      history: [14, 15, 13, 14, 16, 14, 15, 14, 13, 14]
    },
    {
      deviceId: "NODE-EDGE-03",
      deviceName: "Bundaran Waru Node AI",
      type: "Jetson Xavier NX",
      location: "Bundaran Waru",
      coordinates: [-7.3510, 112.7290],
      status: "ONLINE",
      lastSeenAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
      latencyMs: 18,
      packetLossPercent: 0,
      fps: 25,
      resolution: "1080p",
      temperatureC: 68,
      cpuPercent: 74,
      memoryPercent: 62,
      uptimePercent: 99.2,
      firmwareVersion: "v2.1.0-sits",
      streamStatus: "ONLINE",
      greenWaveSync: true,
      errorCount: 0,
      consecutiveFailures: 0,
      healthScore: 92,
      healthLevel: "HEALTHY",
      updatedAt: new Date().toISOString(),
      source: "REALTIME-DERIVED",
      history: [18, 17, 19, 18, 20, 18, 17, 19, 18, 18]
    },
    {
      deviceId: "NODE-CTRL-01",
      deviceName: "Controller Demo 01",
      type: "Edge PLC Siemens",
      location: "Lokasi demo 01",
      coordinates: [-7.3180, 112.7330],
      status: "ONLINE",
      lastSeenAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
      latencyMs: 8,
      packetLossPercent: 0,
      fps: 0,
      resolution: "N/A",
      temperatureC: 38,
      cpuPercent: 32,
      memoryPercent: 28,
      uptimePercent: 99.9,
      firmwareVersion: "v4.2.1-siemens",
      streamStatus: "N/A",
      greenWaveSync: true,
      errorCount: 0,
      consecutiveFailures: 0,
      healthScore: 100,
      healthLevel: "HEALTHY",
      updatedAt: new Date().toISOString(),
      source: "REALTIME-DERIVED",
      history: [8, 8, 9, 7, 8, 8, 9, 8, 7, 8]
    }
  ],

  // Canonical Normalized Domain Collections (Phase 2 Canonical Architecture)
  provenance: "SIMULATED",
  canonical: {
    telemetry: normalizeCanonicalTelemetry({
      timestamp: "--:--:-- WIB",
      networkLoad: 72,
      avgWaitTime: 42,
      congestionIndex: 62,
      co2SavedKg: 1420,
      fuelSavedLiters: 580,
      vehiclesToday: 128540,
      sitsUptime: 99.4,
      cctvOnline: 184,
      iotOnline: 312,
      aiScore: 92,
      aiConfidence: 96,
      source: "server",
      provenance: "SIMULATED"
    }),
    intersections: createNormalizedCollection([
      { id: "node-wonokromo", name: "Simpang Wonokromo", state: "green", timer: 35, greenSplit: 35, waitTime: 42, status: "Normal" },
      { id: "node-jemursari", name: "Simpang Jemursari", state: "red", timer: 25, greenSplit: 28, waitTime: 36, status: "Lancar" },
      { id: "node-darmo", name: "Simpang Raya Darmo", state: "green", timer: 28, greenSplit: 42, waitTime: 28, status: "Lancar" },
      { id: "node-tunjungan", name: "Simpang Tunjungan", state: "yellow", timer: 3, greenSplit: 30, waitTime: 48, status: "Padat" },
      { id: "node-merr", name: "Simpang MERR Kertajaya", state: "green", timer: 45, greenSplit: 45, waitTime: 22, status: "Lancar" }
    ].map(normalizeCanonicalIntersection)),
    devices: createNormalizedCollection([
      { deviceId: "NODE-EDGE-01", deviceName: "Jl. Ahmad Yani (Wonokromo) Node AI", type: "Jetson Orin Nano", location: "Jl. Ahmad Yani (Wonokromo)", coordinates: [-7.2985, 112.7345], status: "ONLINE", latencyMs: 12, fps: 28, resolution: "1080p", temperatureC: 42, cpuPercent: 48, memoryPercent: 45, greenWaveSync: true, healthScore: 100, healthLevel: "HEALTHY" },
      { deviceId: "NODE-EDGE-02", deviceName: "Jl. Raya Darmo (Taman Bungkul) Node AI", type: "Jetson Orin Nano", location: "Jl. Raya Darmo (Taman Bungkul)", coordinates: [-7.2810, 112.7395], status: "ONLINE", latencyMs: 14, fps: 29, resolution: "1080p", temperatureC: 45, cpuPercent: 52, memoryPercent: 49, greenWaveSync: true, healthScore: 100, healthLevel: "HEALTHY" },
      { deviceId: "NODE-EDGE-03", deviceName: "Bundaran Waru Node AI", type: "Jetson Xavier NX", location: "Bundaran Waru", coordinates: [-7.3510, 112.7290], status: "ONLINE", latencyMs: 18, fps: 25, resolution: "1080p", temperatureC: 68, cpuPercent: 74, memoryPercent: 62, greenWaveSync: true, healthScore: 92, healthLevel: "HEALTHY" },
      { deviceId: "NODE-CTRL-01", deviceName: "Controller Demo 01", type: "Perangkat contoh", location: "Lokasi demo 01", coordinates: [-7.3180, 112.7330], status: "SIMULATED", latencyMs: 0, fps: 0, resolution: "N/A", temperatureC: null, cpuPercent: null, memoryPercent: null, greenWaveSync: false, healthScore: null, healthLevel: "SIMULATED" }
    ].map(normalizeCanonicalDevice)),
    incidents: createNormalizedCollection([
      { id: "101", title: "Mogok Truk Treler", location: "Simpang Wonokromo (DTC)", status: "ACTIVE", severity: "danger", category: "accident" },
      { id: "102", title: "Genangan Air Hujan (15cm)", location: "Koridor Manyar Kertoarjo", status: "ACTIVE", severity: "warning", category: "weather" },
      { id: "103", title: "Antrean Lampu Merah Pajang", location: "Simpang Jemursari - A. Yani", status: "ACTIVE", severity: "warning", category: "congestion" }
    ].map(normalizeCanonicalIncident)),
    emergencies: createNormalizedCollection([
      { id: "EMG-101", code: "AMB-01", route: "route-soetomo", vehicle: "Ambulans RSU Dr. Soetomo", status: "PRIORITAS AKTIF", timestamp: "" }
    ].map(normalizeCanonicalEmergency))
  }
};

const STATE_DOMAINS = {
  ui: ['currentView', 'theme', 'isSirenMuted', 'activeIncidentFilter', 'cctvPaused', 'cctvBoxesVisible', 'activeCamId'],
  connection: ['sseConnected', 'connectionStatus', 'lastConnectedAt', 'lastDisconnectedAt', 'connectionAttemptCount', 'isStaleData'],
  traffic: ['telemetry', 'isChaosMode', 'chaosLevel', 'greenWaveActive', 'greenSplitWonokromo', 'isRainMode', 'roadCondition'],
  intersections: ['intersections'], incidents: ['incidents'], emergencies: ['activeEmergencies', 'emergency112Active'],
  devices: ['devices'], signals: ['lastReceivedSignalSequence'], cctv: ['cctvVisionData', 'lastReceivedCctvSequence'],
  analytics: [], simulation: [], diagnostics: []
};
function domainForKey(key) {
  for (const [domain, keys] of Object.entries(STATE_DOMAINS)) if (keys.includes(key)) return domain;
  return null;
}
function setPathImmutable(node, keys, value) {
  if (!keys.length) return value;
  const [key, ...rest] = keys;
  const current = node?.[key];
  const child = setPathImmutable(current && typeof current === 'object' ? current : {}, rest, value);
  if (Object.is(current, child)) return node;
  return Array.isArray(node) ? node.map((entry, index) => String(index) === key ? child : entry) : { ...(node || {}), [key]: child };
}
function evaluateTrackedSelector(selector, state) {
  const dependencies = new Set();
  const proxies = new WeakMap();
  const proxySources = new WeakMap();
  const trackedProxy = (source, path = '') => {
    if (!source || typeof source !== 'object') return source;
    if (proxies.has(source)) return proxies.get(source);
    const proxy = new Proxy({}, {
      get(_target, key) {
        if (typeof key === 'string') dependencies.add(path ? `${path}.${key}` : key);
        const value = source[key];
        return value && typeof value === 'object' ? trackedProxy(value, path ? `${path}.${String(key)}` : String(key)) : value;
      },
      ownKeys() { return Reflect.ownKeys(source); },
      getOwnPropertyDescriptor(_target, key) {
        const descriptor = Object.getOwnPropertyDescriptor(source, key);
        return descriptor ? { ...descriptor, configurable: true } : undefined;
      }
    });
    proxies.set(source, proxy);
    proxySources.set(proxy, source);
    return proxy;
  };
  const selected = selector(trackedProxy(state));
  const value = proxySources.get(selected) || selected;
  for (const dependency of [...dependencies]) {
    if ([...dependencies].some(candidate => candidate !== dependency && candidate.startsWith(`${dependency}.`))) dependencies.delete(dependency);
  }
  return { value, dependencies };
}
const DEVELOPMENT_ASSERTIONS = typeof process !== 'undefined' && process?.env?.NODE_ENV !== 'production';
function upsertNormalizedCollection(collection, item, id, keySelector = value => value.id) {
  const key = String(id);
  const current = collection || { byId: {}, allIds: [] };
  const previous = current.byId?.[key];
  const nextItem = previous ? { ...previous, ...item } : item;
  if (previous && Object.keys(item).every(field => Object.is(previous[field], item[field]))) return current;
  return {
    byId: { ...current.byId, [key]: nextItem },
    allIds: previous ? current.allIds : [...current.allIds, key]
  };
}
function shallowValueEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  }
  return shallowEqual(a, b);
}
function reuseEntityArray(previous = [], incoming = [], idField = 'id') {
  if (!Array.isArray(incoming)) return incoming;
  const previousById = new Map(previous.map(item => [String(item?.[idField]), item]));
  const next = incoming.map(item => {
    const old = previousById.get(String(item?.[idField]));
    if (!old) return item;
    const keys = Object.keys(item || {});
    return keys.length === Object.keys(old || {}).length && keys.every(key => shallowValueEqual(old[key], item[key])) ? old : item;
  });
  if (next.length === previous.length && next.every((item, index) => item === previous[index])) return previous;
  return next;
}
function snapshotValueEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  return keysA.length === keysB.length && keysA.every(key => Object.prototype.hasOwnProperty.call(b, key) && snapshotValueEqual(a[key], b[key]));
}
function reuseNormalizedCollection(previous, incoming) {
  const old = previous || { byId: {}, allIds: [] };
  const byId = {};
  const allIds = [];
  for (const id of incoming.allIds) {
    const item = incoming.byId[id];
    const oldItem = old.byId?.[id];
    byId[id] = oldItem && snapshotValueEqual(oldItem, item) ? oldItem : item;
    allIds.push(id);
  }
  if (allIds.length === old.allIds.length && allIds.every((id, index) => id === old.allIds[index] && byId[id] === old.byId[id])) return old;
  return { byId, allIds };
}
function reconcileCanonicalCollection(previousCanonical, previousLegacy, incomingLegacy, normalizer, idSelector) {
  const previousItems = new Map((previousLegacy || []).map(item => [String(idSelector(item)), item]));
  const normalized = incomingLegacy.map(item => {
    const id = String(idSelector(item));
    const previousEntity = previousCanonical?.byId?.[id];
    if (previousEntity && previousItems.get(id) === item) return previousEntity;
    return normalizer(item);
  });
  return reuseNormalizedCollection(previousCanonical, createNormalizedCollection(normalized));
}

export class StateStore {
  constructor() {
    this._state = deepClone(INITIAL_STATE);
    if (DEVELOPMENT_ASSERTIONS) deepFreeze(this._state);
    this._selectorListeners = new Set();
    this._version = 1;
    this._batchDepth = 0;
    this._batch = null;
    this._domainVersions = Object.create(null);
    this._performance = { updates: [], selectorCallbacks: [], mutationDurations: [], maxMutationDurationMs: 0 };
  }

  /**
   * Mengambil snapshot state saat ini (Immutable & Readonly)
   * @returns {Readonly<typeof INITIAL_STATE>}
   */
  getState() {
    // State is immutable by convention: mutations must go through Store APIs.
    // Returning the stable root reference avoids a full-tree clone on read paths.
    return this._state;
  }

  /**
   * Mengambil versi state terkini
   */
  getVersion() {
    return this._version;
  }

  /**
   * Memperbarui sebagian state dan memancarkan event
   * @param {Partial<typeof INITIAL_STATE> | ((prevState: typeof INITIAL_STATE) => Partial<typeof INITIAL_STATE>)} updateArg
   * @param {Object} [options]
   * @param {boolean} [options.emitGeneric=true]
   * @param {string} [options.source='local']
   */
  setState(updateArg, options = {}) {
    const mutationStarted = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const { emitGeneric = true, source = 'local' } = typeof options === 'boolean' ? { emitGeneric: options } : options;
    const prevState = this._state;
    const partialState = typeof updateArg === 'function' ? updateArg(prevState) : updateArg;
    if (!partialState || typeof partialState !== 'object') return;

    let nextState = prevState;
    const changedKeys = [];

    for (const [key, val] of Object.entries(partialState)) {
      if (key === 'telemetry' && typeof val === 'object' && val !== null) {
        const current = prevState.telemetry || {};
        const entries = Object.entries(val).filter(([field, value]) => !Object.is(current[field], value));
        if (entries.length) {
          if (nextState === prevState) nextState = { ...prevState };
          nextState.telemetry = { ...current, ...Object.fromEntries(entries) };
          changedKeys.push(key);
        }
      } else {
        if (!Object.is(prevState[key], val)) {
          if (nextState === prevState) nextState = { ...prevState };
          nextState[key] = val;
          changedKeys.push(key);
        }
      }
    }

    if (!changedKeys.length) return;

    this._version++;
    const nowIso = new Date().toISOString();
    nextState.stateVersion = this._version;
    nextState.lastUpdated = nowIso;
    const domains = new Set(changedKeys.map(domainForKey).filter(Boolean));
    const versions = { ...(nextState.versions || {}) };
    for (const domain of domains) {
      this._domainVersions[domain] = (this._domainVersions[domain] || 0) + 1;
      versions[domain] = this._domainVersions[domain];
    }
    if (domains.size) nextState.versions = versions;
    if (DEVELOPMENT_ASSERTIONS) deepFreeze(nextState);
    this._state = nextState;
    diagnostics.recordStateUpdate();
    this._recordPerformance('updates');
    const duration = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - mutationStarted;
    this._performance.mutationDurations.push({ at: Date.now(), value: duration });
    this._performance.maxMutationDurationMs = Math.max(this._performance.maxMutationDurationMs, duration);
    this._prunePerformance();

    if (this._batchDepth) {
      this._batch.changedKeys = new Set([...this._batch.changedKeys, ...changedKeys]);
      this._batch.emitGeneric ||= emitGeneric;
      this._batch.sources.add(source);
      return;
    }
    this._emitCommit(prevState, changedKeys, emitGeneric, source);
  }

  _emitCommit(prevState, changedKeys, emitGeneric, source) {
    const snapshot = this._state;
    if (emitGeneric) this.publish('state:changed', createEventEnvelope('state:changed', {
      prev: prevState, current: snapshot, changedKeys
    }, source, this._version));

    const changedSet = new Set(changedKeys);
    for (const key of changedKeys) {
      const previous = prevState[key];
      const current = snapshot[key];
      if (!previous || !current || typeof previous !== 'object' || typeof current !== 'object') continue;
      const nestedKeys = new Set([...Object.keys(previous), ...Object.keys(current)]);
      for (const nestedKey of nestedKeys) if (!Object.is(previous[nestedKey], current[nestedKey])) changedSet.add(`${key}.${nestedKey}`);
    }
    const dependencyChanged = key => key.includes('.')
      ? changedSet.has(key) || [...changedSet].some(changed => changed.startsWith(`${key}.`))
      : changedSet.has(key) || [...changedSet].some(changed => changed.startsWith(`${key}.`));
    for (const listener of [...this._selectorListeners]) {
      if (![...listener.dependencies].some(dependencyChanged)) continue;
      try {
        const evaluated = evaluateTrackedSelector(listener.selector, snapshot);
        const nextSelected = evaluated.value;
        listener.dependencies = evaluated.dependencies;
        if (!listener.equalityFn(listener.current, nextSelected)) {
          const previous = listener.current;
          listener.current = nextSelected;
          this._recordPerformance('selectorCallbacks');
          listener.callback(nextSelected, previous);
        }
      } catch (err) {
        console.error('[StateStore] Selector error:', err);
      }
    }

    // Key-specific subscriptions for backwards compatibility
    for (const key of changedKeys) {
      this.publish(`state:${key}`, { value: snapshot[key], prev: prevState[key] });
    }

    // Trigger standardized domain events if related keys changed
    if (changedKeys.includes('telemetry') || changedKeys.includes('intersections') || changedKeys.includes('isChaosMode') || changedKeys.includes('greenWaveActive')) {
      const trafficEnvelope = createEventEnvelope('traffic:update', {
        telemetry: snapshot.telemetry,
        intersections: snapshot.intersections,
        isChaosMode: snapshot.isChaosMode,
        chaosLevel: snapshot.chaosLevel,
        greenWaveActive: snapshot.greenWaveActive,
        greenSplitWonokromo: snapshot.greenSplitWonokromo,
        activeEmergencies: snapshot.activeEmergencies
      }, source, this._version);
      this.publish('traffic:update', trafficEnvelope);
      this.publish('telemetry:update', snapshot.telemetry);
    }
  }

  /** Coalesce synchronous domain changes and notify subscribers once at commit. */
  batch(mutator) {
    if (typeof mutator !== 'function') return;
    const outermost = this._batchDepth === 0;
    if (outermost) this._batch = { prevState: this._state, changedKeys: new Set(), emitGeneric: false, sources: new Set() };
    this._batchDepth++;
    try {
      return mutator();
    } finally {
      this._batchDepth--;
      if (outermost) {
        const batch = this._batch;
        this._batch = null;
        if (batch.changedKeys.size) this._emitCommit(batch.prevState, [...batch.changedKeys], batch.emitGeneric, batch.sources.size === 1 ? [...batch.sources][0] : 'batch');
      }
    }
  }

  _recordPerformance(metric) {
    this._performance[metric].push(Date.now());
    this._prunePerformance();
  }

  _prunePerformance() {
    const cutoff = Date.now() - 1000;
    for (const metric of ['updates', 'selectorCallbacks']) {
      while (this._performance[metric].length && this._performance[metric][0] < cutoff) this._performance[metric].shift();
    }
    while (this._performance.mutationDurations.length && this._performance.mutationDurations[0].at < cutoff) this._performance.mutationDurations.shift();
    this._performance.maxMutationDurationMs = Math.max(0, ...this._performance.mutationDurations.map(item => item.value));
  }

  getDiagnostics() {
    this._prunePerformance();
    const durations = this._performance.mutationDurations.map(item => item.value);
    return {
      stateUpdatesPerSecond: this._performance.updates.length,
      selectorCallbacksPerSecond: this._performance.selectorCallbacks.length,
      averageMutationDurationMs: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0,
      maxMutationDurationMs: this._performance.maxMutationDurationMs,
      activeSelectorSubscriptions: this._selectorListeners.size,
      activeEventSubscriptions: eventBus.getListenerCount(),
      domainVersions: { ...this._domainVersions }
    };
  }

  updateDomain(domain, partial, options = {}) {
    const domainKeys = {
      traffic: ['telemetry', 'intersections', 'activeEmergencies', 'isChaosMode', 'chaosLevel', 'greenWaveActive', 'greenSplitWonokromo', 'lastTelemetryAt', 'lastTelemetryTime', 'lastTelemetrySource', 'lastReceivedSequence', 'isStaleData', 'canonical'],
      intersections: ['intersections', 'canonical'], incidents: ['incidents', 'canonical', 'lastReceivedIncidentSequence'],
      emergencies: ['activeEmergencies', 'emergency112Active', 'greenWaveActive', 'canonical', 'lastReceivedEmergencySequence'],
      devices: ['devices', 'canonical', 'lastReceivedDeviceSequence'], signals: ['intersections', 'canonical', 'lastReceivedSignalSequence'],
      cctv: ['cctvVisionData', 'cctvCamerasMetrics', 'lastReceivedCctvSequence'],
      connection: ['connectionStatus', 'sseConnected', 'lastConnectedAt', 'lastDisconnectedAt', 'lastTelemetryAt', 'lastTelemetryTime', 'connectionAttemptCount', 'isStaleData', 'lastReceivedSequence'],
      ui: ['currentView', 'theme', 'isSirenMuted', 'activeIncidentFilter', 'cctvPaused', 'cctvBoxesVisible', 'activeCamId'],
    }[domain];
    if (!domainKeys) throw new Error(`Unknown state domain: ${domain}`);
    for (const key of Object.keys(partial || {})) if (!domainKeys.includes(key)) throw new Error(`State key '${key}' does not belong to domain '${domain}'`);
    return this.setState(partial, options);
  }

  updateTraffic(partial, options) { return this.updateDomain('traffic', partial, options); }
  updateIntersection(partial, options) { return this.updateDomain('intersections', partial, options); }
  updateIncident(partial, options) { return this.updateDomain('incidents', partial, options); }
  updateEmergency(partial, options) { return this.updateDomain('emergencies', partial, options); }
  updateSignal(partial, options) { return this.updateDomain('signals', partial, options); }
  updateDevice(partial, options) { return this.updateDomain('devices', partial, options); }
  updateCctv(partial, options) { return this.updateDomain('cctv', partial, options); }
  updateConnection(partial, options) { return this.updateDomain('connection', partial, options); }

  /**
   * Memperbarui data bersarang dengan aman
   * @param {string} path Contoh: 'telemetry.networkLoad' atau 'intersections.0.state'
   * @param {*} value
   * @param {string} [source='local']
   */
  setNestedState(path, value, source = 'local') {
    const keys = path.split('.');
    const next = setPathImmutable(this._state, keys, value);
    const rootKey = keys[0];
    if (next !== this._state) this.setState({ [rootKey]: next[rootKey] }, { source });
  }

  /**
   * Berlangganan granular ke bagian/slice state saja (Phase 8 Selector pattern)
   * Callback hanya dipanggil jika hasil selector berubah.
   * @param {(state: typeof INITIAL_STATE) => any} selector
   * @param {(selectedVal: any, prevVal: any) => void} callback
   * @returns {() => void} Fungsi unsubscribe
   */
  subscribeSelector(selector, callback, equalityFn = Object.is) {
    if (typeof selector !== 'function' || typeof callback !== 'function') {
      return () => {};
    }
    const evaluated = evaluateTrackedSelector(selector, this._state);
    const listener = { selector, callback, equalityFn: typeof equalityFn === 'function' ? equalityFn : Object.is, current: evaluated.value, dependencies: evaluated.dependencies };
    this._selectorListeners.add(listener);
    return () => this._selectorListeners.delete(listener);
  }

  /**
   * Berlangganan ke event tertentu
   * @param {string} event
   * @param {Function} callback
  /**
   * Berlangganan ke event tertentu (Didelegasikan ke EventBus)
   * @param {string} event
   * @param {Function} callback
   * @returns {() => void} Fungsi unsubscribe aman
   */
  subscribe(event, callback) {
    return eventBus.subscribe(event, callback);
  }

  /**
   * Memancarkan event ke semua subscriber (Didelegasikan ke EventBus)
   * @param {string} event
   * @param {*} [payload]
   */
  publish(event, payload) {
    eventBus.publish(event, payload);
  }

  /**
   * Membersihkan seluruh listener (digunakan untuk reset / teardown)
   */
  clearListeners() {
    eventBus.clearListeners();
    this._selectorListeners.clear();
  }

  /**
   * Mengambil canonical domain slice atau normalized collection
   * @param {'telemetry'|'intersections'|'devices'|'incidents'|'emergencies'} domainKey
   */
  getCanonicalDomain(domainKey) {
    const canonical = this._state.canonical || {};
    return canonical[domainKey] || null;
  }

  /**
   * O(1) Primary Key Lookups via Normalized Collections
   */
  getIntersectionById(id) {
    if (!id) return null;
    const strId = String(id);
    return this._state.canonical?.intersections?.byId?.[strId] ||
      (this._state.intersections || []).find(n => String(n.id) === strId) || null;
  }

  getDeviceById(id) {
    if (!id) return null;
    const strId = String(id);
    return this._state.canonical?.devices?.byId?.[strId] ||
      (this._state.devices || []).find(d => String(d.deviceId) === strId || String(d.id) === strId) || null;
  }

  getIncidentById(id) {
    if (!id) return null;
    const strId = String(id);
    return this._state.canonical?.incidents?.byId?.[strId] ||
      (this._state.incidents || []).find(i => String(i.id) === strId) || null;
  }

  getEmergencyById(id) {
    if (!id) return null;
    const strId = String(id);
    return this._state.canonical?.emergencies?.byId?.[strId] ||
      (this._state.activeEmergencies || []).find(e => String(e.id) === strId || String(e.vehicleId) === strId) || null;
  }
}

export const stateStore = new StateStore();

// ============================================================================
// HELPER AKSI STATE TERPUSAT (CENTRALIZED ACTION DISPATCHERS)
// ============================================================================

/**
 * Mengatur Status Lifecycle Koneksi & Sinkronisasi Metadata
 * @param {'connecting'|'connected'|'reconnecting'|'offline'|'resyncing'|'fallback'|'auth_failed'|'degraded'} status
 * @param {Object} [metadata={}]
 */
export function setConnectionLifecycle(status, metadata = {}) {
  const currentState = stateStore.getState();
  const updates = {
    connectionStatus: status,
    sseConnected: status === 'connected' || status === 'resyncing' || status === 'degraded',
    ...metadata
  };

  if (status === 'connected') {
    updates.lastConnectedAt = updates.lastConnectedAt || Date.now();
    updates.isStaleData = false;
  } else if (status === 'degraded') {
    updates.isStaleData = false;
  } else if (status === 'auth_failed') {
    updates.lastDisconnectedAt = updates.lastDisconnectedAt || Date.now();
    updates.isStaleData = true;
  } else if (status === 'offline' || status === 'fallback') {
    updates.lastDisconnectedAt = updates.lastDisconnectedAt || Date.now();
    updates.isStaleData = true;
  } else if (status === 'reconnecting') {
    updates.isStaleData = true;
  }

  stateStore.setState(updates, { source: 'socket' });
  stateStore.publish("socket:status", createEventEnvelope("socket:status", { status, ...updates }, "socket"));
  stateStore.publish("socket:connected", updates.sseConnected);
}

/**
 * Menandai Status Data Stale (Basi / Terakhir Tersimpan)
 * @param {boolean} isStale
 */
export function markStaleData(isStale) {
  const current = stateStore.getState().isStaleData;
  if (current !== !!isStale) {
    stateStore.setState({ isStaleData: !!isStale }, { source: 'watchdog' });
    stateStore.publish("state:stale-changed", { isStale: !!isStale });
  }
}

/**
 * Menerapkan Snapshot Server Kanonikal Penuh secara Atomik (Phase 18 Hardened Resynchronization)
 * @param {Object} serverState
 * @param {string} [source='server']
 */
export function applyServerSnapshot(serverState, source = 'server') {
  if (!serverState || typeof serverState !== 'object') return;

  const rawState = serverState.state || serverState.data || serverState;
  const seq = serverState.seq ?? serverState.sequence ?? rawState.seq ?? rawState.sequence ?? 0;
  const cctvSeq = serverState.cctvSeq ?? rawState.cctvSeq ?? serverState.cctvSequence ?? rawState.cctvSequence ?? seq;
  const incidentSeq = serverState.incidentSeq ?? rawState.incidentSeq ?? serverState.incidentSequence ?? rawState.incidentSequence ?? seq;
  const emergencySeq = serverState.emergencySeq ?? rawState.emergencySeq ?? serverState.emergencySequence ?? rawState.emergencySequence ?? seq;
  const signalSeq = serverState.signalSeq ?? rawState.signalSeq ?? serverState.signalSequence ?? rawState.signalSequence ?? seq;
  const deviceSeq = serverState.deviceSeq ?? rawState.deviceSeq ?? serverState.deviceSequence ?? rawState.deviceSequence ?? seq;
  // The legacy `timestamp` field can be a presentation-only clock such as
  // `08:41:00 WIB`. Prefer the transport epoch/ISO fields and fail back to now
  // instead of allowing an invalid date to abort the entire snapshot.
  const rawTimestamp = serverState.timestampMs ?? rawState.timestampMs
    ?? serverState.timestamp ?? rawState.timestamp ?? Date.now();
  let timestampMs = NaN;
  if (Number.isFinite(rawTimestamp)) {
    timestampMs = rawTimestamp;
    if (timestampMs >= 1e9 && timestampMs < 1e11) timestampMs *= 1000;
  } else if (typeof rawTimestamp === 'string' && /^\d{10,13}$/.test(rawTimestamp)) {
    timestampMs = Number(rawTimestamp);
    if (timestampMs < 1e11) timestampMs *= 1000;
  } else if (typeof rawTimestamp === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(rawTimestamp)) {
    timestampMs = Date.parse(rawTimestamp);
  }
  const safeTimestampMs = Number.isFinite(timestampMs) && timestampMs > 0 && timestampMs <= 8.64e15
    ? timestampMs
    : Date.now();
  const serverSessionId = serverState.serverSessionId || rawState.serverSessionId || null;

  const currentStore = stateStore.getState();
  const isNewEpoch = serverSessionId && currentStore.serverSessionId && serverSessionId !== currentStore.serverSessionId;

  if (isNewEpoch) {
    console.info(`🔄 [StateStore] Sesi server / epoch baru terdeteksi (${serverSessionId}). Mereset baseline ordering.`);
  }

  const updates = {
    isChaosMode: !!rawState.isChaosMode,
    chaosLevel: rawState.chaosLevel || 0,
    greenWaveActive: !!rawState.greenWaveActive,
    greenSplitWonokromo: rawState.greenSplitWonokromo || 35,
    isStaleData: false,
    serverSessionId: serverSessionId || currentStore.serverSessionId,
    lastReceivedSequence: seq,
    lastReceivedCctvSequence: cctvSeq,
    lastReceivedIncidentSequence: incidentSeq,
    lastReceivedEmergencySequence: emergencySeq,
    lastReceivedSignalSequence: signalSeq,
    lastReceivedDeviceSequence: deviceSeq,
    lastTelemetryAt: safeTimestampMs,
    lastTelemetryTime: safeTimestampMs,
    lastTelemetrySource: 'server'
  };

  // Update diagnostics with authoritative baseline
  diagnostics.recordAcceptedEvent('traffic', updates.lastReceivedSequence, safeTimestampMs);
  diagnostics.recordAcceptedEvent('cctv', updates.lastReceivedCctvSequence, safeTimestampMs);
  diagnostics.recordAcceptedEvent('incident', updates.lastReceivedIncidentSequence, safeTimestampMs);
  diagnostics.recordAcceptedEvent('emergency', updates.lastReceivedEmergencySequence, safeTimestampMs);
  diagnostics.recordAcceptedEvent('signal', updates.lastReceivedSignalSequence, safeTimestampMs);
  diagnostics.recordAcceptedEvent('device', updates.lastReceivedDeviceSequence, safeTimestampMs);

  if (Array.isArray(rawState.intersections)) {
    updates.intersections = reuseEntityArray(currentStore.intersections, rawState.intersections.map(item => ({ ...item })), 'id');
  }
  if (Array.isArray(rawState.activeEmergencies)) {
    updates.activeEmergencies = reuseEntityArray(currentStore.activeEmergencies, rawState.activeEmergencies.map(item => ({ ...item })), 'id');
  }
  if (Array.isArray(rawState.incidents)) {
    updates.incidents = reuseEntityArray(currentStore.incidents, rawState.incidents.map(item => ({ ...item })), 'id');
  }
  if (Array.isArray(rawState.devices)) {
    updates.devices = reuseEntityArray(currentStore.devices, rawState.devices.map(item => ({ ...item })), 'deviceId');
  }

  const telemetryKeys = ['networkLoad', 'avgWaitTime', 'congestionIndex', 'co2SavedKg', 'fuelSavedLiters', 'vehiclesToday', 'sitsUptime', 'cctvOnline', 'iotOnline', 'sitsSignal', 'aiScore', 'aiConfidence', 'timestamp'];
  const telemetryUpdate = {};
  telemetryKeys.forEach(k => {
    if (k in rawState) {
      telemetryUpdate[k] = rawState[k];
    }
  });
  if (Object.keys(telemetryUpdate).length > 0) {
    updates.telemetry = telemetryUpdate;
  }

  // Synchronize Canonical Normalized Domain Collections (Phase 2 Canonical Architecture)
  const incomingIntersections = updates.intersections || currentStore.intersections || [];
  const incomingDevices = updates.devices || currentStore.devices || [];
  const incomingIncidents = updates.incidents || currentStore.incidents || [];
  const incomingEmergencies = updates.activeEmergencies || currentStore.activeEmergencies || [];
  const incomingTelemetry = updates.telemetry || currentStore.telemetry || {};

  const canonicalIntersections = reconcileCanonicalCollection(currentStore.canonical?.intersections, currentStore.intersections, incomingIntersections, normalizeCanonicalIntersection, item => item.id);
  const canonicalDevices = reconcileCanonicalCollection(currentStore.canonical?.devices, currentStore.devices, incomingDevices, normalizeCanonicalDevice, item => item.deviceId || item.id);
  const canonicalIncidents = reconcileCanonicalCollection(currentStore.canonical?.incidents, currentStore.incidents, incomingIncidents, normalizeCanonicalIncident, item => item.id);
  const canonicalEmergencies = reconcileCanonicalCollection(currentStore.canonical?.emergencies, currentStore.activeEmergencies, incomingEmergencies, normalizeCanonicalEmergency, item => item.id);
  const normalizedTelemetry = normalizeCanonicalTelemetry({
    ...incomingTelemetry,
    source: 'server',
    provenance: 'SIMULATED',
    updatedAt: new Date(safeTimestampMs).toISOString()
  });
  const previousCanonical = currentStore.canonical || {};
  const canonicalTelemetry = snapshotValueEqual(previousCanonical.telemetry, normalizedTelemetry) ? previousCanonical.telemetry : normalizedTelemetry;

  updates.provenance = 'SIMULATED';
  const canonical = {
    telemetry: canonicalTelemetry,
    intersections: canonicalIntersections,
    devices: canonicalDevices,
    incidents: canonicalIncidents,
    emergencies: canonicalEmergencies
  };
  updates.canonical = Object.keys(canonical).every(key => canonical[key] === previousCanonical[key]) ? previousCanonical : canonical;

  stateStore.setState(updates, { source });
  stateStore.publish("state:resynced", createEventEnvelope("state:resynced", updates, source, seq));
}

/**
 * Validasi dan pelacakan sequence paket telemetri / event dari server SITS.
 * Membantu mendeteksi packet yang malformed, out-of-order, duplicate, atau outdated.
 * @param {Object} payload
 * @param {string} source
 * @param {string} topicKey
 * @returns {boolean} True jika paket valid dan layak diproses
 */
export function validateAndTrackSequence(payload, source, topicKey) {
  if (!payload || typeof payload !== 'object') {
    console.warn(`[StateStore] [${topicKey}] Packet is null or not an object`);
    return false;
  }

  // Local updates are trusted and skip sequence checking
  if (source !== 'server') {
    return true;
  }

  // 1. Validate fields: must have timestamp, sequence/seq, and source
  const timestamp = payload.timestamp || payload.timestampMs || payload.time;
  const seq = payload.seq || payload.sequence || payload.version || 0;
  const packetSource = payload.source || 'server';

  if (!timestamp || !seq || !packetSource) {
    console.warn(`[StateStore] [${topicKey}] Malformed packet ignored. Missing critical headers.`, payload);
    diagnostics.recordDroppedEvent(topicKey, seq || 0, 'malformed_missing_headers');
    return false;
  }

  const currentState = stateStore.getState();
  
  // Map topicKey to its corresponding sequence property in state
  const seqPropMap = {
    'traffic': 'lastReceivedSequence',
    'cctv': 'lastReceivedCctvSequence',
    'incident': 'lastReceivedIncidentSequence',
    'emergency': 'lastReceivedEmergencySequence',
    'signal': 'lastReceivedSignalSequence',
    'device': 'lastReceivedDeviceSequence'
  };

  const propName = seqPropMap[topicKey] || 'lastReceivedSequence';
  const currentSeq = currentState[propName] || 0;
  const lastTelemetryAt = currentState.lastTelemetryAt || 0;

  // 2. Ignore duplicate packets
  if (seq === currentSeq) {
    console.warn(`[StateStore] [${topicKey}] Duplicate packet ignored (seq: ${seq})`);
    diagnostics.recordDuplicateEvent(topicKey, seq);
    return false;
  }

  // 3. Ignore out-of-order/older packets
  if (seq < currentSeq) {
    console.warn(`[StateStore] [${topicKey}] Out-of-order packet ignored (seq: ${seq} < currentSeq: ${currentSeq})`);
    diagnostics.recordDroppedEvent(topicKey, seq, 'out_of_order');
    return false;
  }

  // 4. Ignore packets older than active state (timestamp-wise)
  const packetTime = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp) || Date.now();
  if (lastTelemetryAt > 0 && packetTime < (lastTelemetryAt - 5000)) {
    console.warn(`[StateStore] [${topicKey}] Outdated packet by timestamp ignored (${packetTime} < ${lastTelemetryAt})`);
    diagnostics.recordDroppedEvent(topicKey, seq, 'stale_timestamp');
    return false;
  }

  // 5. Gap detection
  if (currentSeq > 0 && seq > currentSeq + 1) {
    console.warn(`[StateStore] [${topicKey}] Sequence gap detected (expected ${currentSeq + 1}, received ${seq}). Publishing gap-detected.`);
    stateStore.publish("socket:gap-detected", {
      topic: topicKey,
      expected: currentSeq + 1,
      received: seq,
      gap: seq - currentSeq
    });
  }

  // Record valid accepted event in diagnostics
  diagnostics.recordAcceptedEvent(topicKey, seq, packetTime);
  return true;
}

/**
 * Memperbarui State Lalu Lintas Global
 * Dilengkapi validasi sequence, deteksi packet out-of-order, dan pencegahan dual-tick race condition.
 */
export function updateTrafficState(payload, source = 'server') {
  if (!payload || typeof payload !== 'object') return;

  const currentState = stateStore.getState();

  // Guard: Jika sedang terhubung ke server, abaikan pembaruan dari local-simulator
  if (source === 'local-simulator' && (currentState.connectionStatus === 'connected' || currentState.connectionStatus === 'resyncing')) {
    return;
  }

  // Validasi dan pelacakan sequence / out-of-order
  if (!validateAndTrackSequence(payload, source, 'traffic')) {
    return;
  }

  let incomingSeq = payload.seq || payload.sequence || 0;

  const updates = {};
  if ('isChaosMode' in payload) updates.isChaosMode = payload.isChaosMode;
  if ('chaosLevel' in payload) updates.chaosLevel = payload.chaosLevel;
  if ('greenWaveActive' in payload) updates.greenWaveActive = payload.greenWaveActive;
  if ('greenSplitWonokromo' in payload) updates.greenSplitWonokromo = payload.greenSplitWonokromo;
  if ('intersections' in payload && Array.isArray(payload.intersections)) updates.intersections = reuseEntityArray(currentState.intersections, payload.intersections.map(item => ({ ...item })), 'id');
  if ('activeEmergencies' in payload && Array.isArray(payload.activeEmergencies)) updates.activeEmergencies = reuseEntityArray(currentState.activeEmergencies, payload.activeEmergencies.map(item => ({ ...item })), 'id');

  // Extract telemetry metrics
  const telemetryKeys = ['networkLoad', 'avgWaitTime', 'congestionIndex', 'co2SavedKg', 'fuelSavedLiters', 'vehiclesToday', 'sitsUptime', 'cctvOnline', 'iotOnline', 'sitsSignal', 'aiScore', 'aiConfidence', 'timestamp'];
  const telemetryUpdate = {};
  let hasTelemetry = false;

  telemetryKeys.forEach(k => {
    if (k in payload) {
      telemetryUpdate[k] = payload[k];
      hasTelemetry = true;
    }
  });

  if (hasTelemetry) {
    updates.telemetry = telemetryUpdate;
  }

  const now = Date.now();
  updates.lastTelemetryTime = now;
  updates.lastTelemetryAt = now;
  updates.lastTelemetrySource = source;

  if (source === 'server') {
    updates.isStaleData = false;
    if (incomingSeq > 0) {
      updates.lastReceivedSequence = incomingSeq;
    }
  }

  const curState = stateStore.getState();
  const curCanonical = curState.canonical || {};
  let nextCanonical = curCanonical;
  const setCanonical = (key, value) => {
    if (nextCanonical === curCanonical) nextCanonical = { ...curCanonical };
    nextCanonical[key] = value;
  };

  if (updates.telemetry) {
    setCanonical('telemetry', normalizeCanonicalTelemetry({
      ...curState.telemetry,
      ...updates.telemetry,
      source,
      provenance: 'SIMULATED',
      updatedAt: new Date(now).toISOString()
    }));
  }

  if (updates.intersections && Array.isArray(updates.intersections)) {
    setCanonical('intersections', createNormalizedCollection(updates.intersections.map(normalizeCanonicalIntersection)));
  }

  if (updates.activeEmergencies && Array.isArray(updates.activeEmergencies)) {
    setCanonical('emergencies', createNormalizedCollection(updates.activeEmergencies.map(normalizeCanonicalEmergency)));
  }

  if (nextCanonical !== curCanonical) updates.canonical = nextCanonical;
  stateStore.updateTraffic(updates, { source });
}

/**
 * Memperbarui State Sinyal APILL Persimpangan
 */
export function updateSignalState(nodeId, signalData, source = 'controller') {
  if (!validateAndTrackSequence(signalData, source, 'signal')) {
    return;
  }
  const incomingSeq = signalData.seq || signalData.sequence || 0;
  const state = stateStore.getState();
  const current = state.intersections || [];
  let nextItem;
  const updated = current.map(node => {
    if (String(node.id) !== String(nodeId)) return node;
    nextItem = { ...node, ...signalData };
    return nextItem;
  });
  if (!nextItem) return;
  const canonical = state.canonical || {};
  const normalized = normalizeCanonicalIntersection(nextItem);
  const canonicalIntersections = upsertNormalizedCollection(canonical.intersections, normalized, nodeId);
  stateStore.updateDomain('signals', {
    intersections: updated,
    canonical: { ...canonical, intersections: canonicalIntersections },
    lastReceivedSignalSequence: source === 'server' && incomingSeq > 0 ? incomingSeq : state.lastReceivedSignalSequence
  }, { source });
  stateStore.publish('signal:update', createEventEnvelope('signal:update', { nodeId, signalData, intersections: updated }, source));
}

/**
 * Memperbarui State Prioritas Darurat 112
 */
export function updateEmergencyState(emergencyPayload, source = 'controller') {
  if (!validateAndTrackSequence(emergencyPayload, source, 'emergency')) {
    return;
  }
  const incomingSeq = emergencyPayload.seq || emergencyPayload.sequence || 0;
  const isGreenWave = !!emergencyPayload.greenWaveActive || !!emergencyPayload.payload?.greenWaveActive;
  const updates = {
    emergency112Active: isGreenWave,
    greenWaveActive: isGreenWave,
    lastReceivedEmergencySequence: source === 'server' && incomingSeq > 0 ? incomingSeq : stateStore.getState().lastReceivedEmergencySequence
  };

  const payloadData = emergencyPayload.payload || emergencyPayload;

  if (Array.isArray(payloadData.activeEmergencies)) {
    updates.activeEmergencies = payloadData.activeEmergencies;
  } else if (payloadData.item || payloadData.emergencyItem) {
    const item = payloadData.item || payloadData.emergencyItem;
    const list = stateStore.getState().activeEmergencies || [];
    const existingIdx = list.findIndex(e => e.id === item.id || e.vehicleId === item.vehicleId);
    const nextItem = existingIdx >= 0 ? { ...list[existingIdx], ...item } : item;
    const updated = existingIdx >= 0 ? list.map((entry, index) => index === existingIdx ? nextItem : entry) : [nextItem, ...list];
    const bounded = updated.length > 5 ? updated.slice(0, 5) : updated;
    updates.activeEmergencies = bounded;
  }

  const currentState = stateStore.getState();
  const finalEmergencies = updates.activeEmergencies || currentState.activeEmergencies || [];
  const canonical = currentState.canonical || {};
  if (updates.activeEmergencies) {
    const emergencies = Array.isArray(payloadData.activeEmergencies)
      ? createNormalizedCollection(updates.activeEmergencies.map(normalizeCanonicalEmergency))
      : upsertNormalizedCollection(canonical.emergencies, normalizeCanonicalEmergency(updates.activeEmergencies[0]), updates.activeEmergencies[0].id);
    updates.canonical = { ...canonical, emergencies };
  }

  stateStore.updateEmergency(updates, { source });
  stateStore.publish("emergency:update", createEventEnvelope("emergency:update", emergencyPayload, source));
}

/**
 * Memperbarui State Insiden (Resolusi / Tambah Baru)
 */
export function updateIncidentState(incidentId, updateData, source = 'controller') {
  if (!validateAndTrackSequence(updateData, source, 'incident')) {
    return;
  }
  const incomingSeq = updateData.seq || updateData.sequence || 0;
  const state = stateStore.getState();
  const currentIncidents = state.incidents || [];
  let nextItem;
  const updated = currentIncidents.map(inc => {
    if (String(inc.id) === String(incidentId)) {
      nextItem = { ...inc, ...updateData };
      return nextItem;
    }
    return inc;
  });

  if (!nextItem) { nextItem = { id: incidentId, ...updateData }; updated.unshift(nextItem); }

  const canonical = state.canonical || {};
  const collection = upsertNormalizedCollection(canonical.incidents, normalizeCanonicalIncident(nextItem), incidentId);

  stateStore.updateIncident({
    incidents: updated,
    canonical: { ...canonical, incidents: collection },
    lastReceivedIncidentSequence: source === 'server' && incomingSeq > 0 ? incomingSeq : state.lastReceivedIncidentSequence
  }, { source });
  stateStore.publish("incident:update", createEventEnvelope("incident:update", { incidentId, updateData, incidents: updated }, source));
}

/**
 * Memperbarui State Perangkat IoT
 */
export function updateDeviceState(deviceId, deviceData, source = 'controller') {
  if (!validateAndTrackSequence(deviceData, source, 'device')) {
    return;
  }
  const incomingSeq = deviceData.seq || deviceData.sequence || 0;
  const state = stateStore.getState();
  const currentDevices = state.devices || [];
  let nextDevice;
  const updated = currentDevices.map(dev => {
    if (String(dev.deviceId) !== String(deviceId)) return dev;
    nextDevice = { ...dev, ...deviceData };
    return nextDevice;
  });
  if (!nextDevice) { nextDevice = { deviceId, ...deviceData }; updated.push(nextDevice); }
  const canonical = state.canonical || {};
  const collection = upsertNormalizedCollection(canonical.devices, normalizeCanonicalDevice(nextDevice), deviceId, value => value.deviceId);

  stateStore.updateDevice({
    devices: updated,
    canonical: { ...canonical, devices: collection },
    lastReceivedDeviceSequence: source === 'server' && incomingSeq > 0 ? incomingSeq : state.lastReceivedDeviceSequence
  }, { source });
  stateStore.publish("device:update", createEventEnvelope("device:update", { deviceId, deviceData, devices: updated }, source));
}

/**
 * Memperbarui State Telemetri Secara Spesifik
 */
export function updateTelemetryState(telemetryData, source = 'server') {
  const now = Date.now();
  const current = stateStore.getState();
  const canonical = current.canonical || {};
  const telemetry = normalizeCanonicalTelemetry({
    ...current.telemetry,
    ...telemetryData,
    source,
    provenance: 'SIMULATED',
    updatedAt: new Date(now).toISOString()
  });

  stateStore.updateTraffic({
    telemetry: telemetryData,
    canonical: { ...canonical, telemetry },
    lastTelemetryTime: now,
    lastTelemetryAt: now,
    lastTelemetrySource: source,
    isStaleData: source === 'server' ? false : current.isStaleData
  }, { source });
}

/**
 * Memperbarui State Deteksi Computer Vision CCTV
 */
export function updateCctvVisionState(framePayload, source = 'server') {
  if (!validateAndTrackSequence(framePayload, source, 'cctv')) {
    return;
  }
  const incomingSeq = framePayload.seq || framePayload.sequence || 0;
  stateStore.updateCctv({
    cctvVisionData: framePayload,
    lastReceivedCctvSequence: source === 'server' && incomingSeq > 0 ? incomingSeq : stateStore.getState().lastReceivedCctvSequence
  }, { source, emitGeneric: false });
  stateStore.publish("cctv:vision-update", createEventEnvelope("cctv:vision-update", framePayload, source));
}

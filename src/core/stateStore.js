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

export class StateStore {
  constructor() {
    this._state = deepClone(INITIAL_STATE);
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
    this._version = 1;
  }

  /**
   * Mengambil snapshot state saat ini (Immutable & Readonly)
   * @returns {Readonly<typeof INITIAL_STATE>}
   */
  getState() {
    return deepFreeze(deepClone(this._state));
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
    const { emitGeneric = true, source = 'local' } = typeof options === 'boolean' ? { emitGeneric: options } : options;
    const prevState = deepClone(this._state);

    const partialState = typeof updateArg === 'function' ? updateArg(deepClone(this._state)) : updateArg;
    if (!partialState || typeof partialState !== 'object') return;

    // Langkah 16: Granular equality check to prevent repeated identical state updates
    let hasActualChange = false;
    const changedKeys = [];

    for (const [key, val] of Object.entries(partialState)) {
      if (key === 'telemetry' && typeof val === 'object' && val !== null) {
        let telChanged = false;
        const curTel = this._state.telemetry || {};
        for (const [tk, tv] of Object.entries(val)) {
          if (curTel[tk] !== tv) {
            telChanged = true;
            break;
          }
        }
        if (telChanged) {
          this._state.telemetry = {
            ...this._state.telemetry,
            ...deepClone(val)
          };
          hasActualChange = true;
          changedKeys.push(key);
        }
      } else {
        const curVal = this._state[key];
        // Fast primitive equality check or reference check
        if (typeof val !== 'object' || val === null) {
          if (curVal !== val) {
            this._state[key] = val;
            hasActualChange = true;
            changedKeys.push(key);
          }
        } else {
          // Object/array update
          this._state[key] = deepClone(val);
          hasActualChange = true;
          changedKeys.push(key);
        }
      }
    }

    if (!hasActualChange) return;

    this._version++;
    const nowIso = new Date().toISOString();
    this._state.stateVersion = this._version;
    this._state.lastUpdated = nowIso;
    diagnostics.recordStateUpdate();

    const snapshot = this.getState();

    // Standard Envelope Event
    if (emitGeneric) {
      this.publish("state:changed", createEventEnvelope("state:changed", {
        prev: prevState,
        current: snapshot,
        changedKeys
      }, source, this._version));
    }

    // Key-specific subscriptions for backwards compatibility
    for (const key of changedKeys) {
      this.publish(`state:${key}`, {
        value: this._state[key],
        prev: prevState[key]
      });
    }

    // Trigger standardized domain events if related keys changed
    if (changedKeys.includes('telemetry') || changedKeys.includes('intersections') || changedKeys.includes('isChaosMode') || changedKeys.includes('greenWaveActive')) {
      const trafficEnvelope = createEventEnvelope("traffic:update", {
        telemetry: snapshot.telemetry,
        intersections: snapshot.intersections,
        isChaosMode: snapshot.isChaosMode,
        chaosLevel: snapshot.chaosLevel,
        greenWaveActive: snapshot.greenWaveActive,
        greenSplitWonokromo: snapshot.greenSplitWonokromo,
        activeEmergencies: snapshot.activeEmergencies
      }, source, this._version);
      this.publish("traffic:update", trafficEnvelope);
      this.publish("telemetry:update", snapshot.telemetry);
    }
  }

  /**
   * Memperbarui data bersarang dengan aman
   * @param {string} path Contoh: 'telemetry.networkLoad' atau 'intersections.0.state'
   * @param {*} value
   * @param {string} [source='local']
   */
  setNestedState(path, value, source = 'local') {
    const keys = path.split('.');
    const nextState = deepClone(this._state);
    let cur = nextState;

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in cur) || typeof cur[k] !== 'object' || cur[k] === null) {
        cur[k] = {};
      }
      cur = cur[k];
    }

    cur[keys[keys.length - 1]] = deepClone(value);
    this.setState(nextState, { source });
  }

  /**
   * Berlangganan granular ke bagian/slice state saja (Phase 8 Selector pattern)
   * Callback hanya dipanggil jika hasil selector berubah.
   * @param {(state: typeof INITIAL_STATE) => any} selector
   * @param {(selectedVal: any, prevVal: any) => void} callback
   * @returns {() => void} Fungsi unsubscribe
   */
  subscribeSelector(selector, callback) {
    if (typeof selector !== 'function' || typeof callback !== 'function') {
      return () => {};
    }
    let currentSelected = selector(this._state);

    return this.subscribe("state:changed", () => {
      try {
        const nextSelected = selector(this._state);
        if (JSON.stringify(currentSelected) !== JSON.stringify(nextSelected)) {
          const prev = currentSelected;
          currentSelected = nextSelected;
          callback(nextSelected, prev);
        }
      } catch (err) {
        console.error('[StateStore] Selector error:', err);
      }
    });
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
  const timestampMs = serverState.timestamp ?? serverState.timestampMs ?? rawState.timestampMs ?? rawState.timestamp ?? Date.now();
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
    lastTelemetryAt: timestampMs,
    lastTelemetryTime: timestampMs,
    lastTelemetrySource: 'server'
  };

  // Update diagnostics with authoritative baseline
  diagnostics.recordAcceptedEvent('traffic', updates.lastReceivedSequence, timestampMs);
  diagnostics.recordAcceptedEvent('cctv', updates.lastReceivedCctvSequence, timestampMs);
  diagnostics.recordAcceptedEvent('incident', updates.lastReceivedIncidentSequence, timestampMs);
  diagnostics.recordAcceptedEvent('emergency', updates.lastReceivedEmergencySequence, timestampMs);
  diagnostics.recordAcceptedEvent('signal', updates.lastReceivedSignalSequence, timestampMs);
  diagnostics.recordAcceptedEvent('device', updates.lastReceivedDeviceSequence, timestampMs);

  if (Array.isArray(rawState.intersections)) {
    updates.intersections = deepClone(rawState.intersections);
  }
  if (Array.isArray(rawState.activeEmergencies)) {
    updates.activeEmergencies = deepClone(rawState.activeEmergencies);
  }
  if (Array.isArray(rawState.incidents)) {
    updates.incidents = deepClone(rawState.incidents);
  }
  if (Array.isArray(rawState.devices)) {
    updates.devices = deepClone(rawState.devices);
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

  const canonicalIntersections = incomingIntersections.map(normalizeCanonicalIntersection);
  const canonicalDevices = incomingDevices.map(normalizeCanonicalDevice);
  const canonicalIncidents = incomingIncidents.map(normalizeCanonicalIncident);
  const canonicalEmergencies = incomingEmergencies.map(normalizeCanonicalEmergency);
  const canonicalTelemetry = normalizeCanonicalTelemetry({
    ...incomingTelemetry,
    source: 'server',
    provenance: 'SIMULATED',
    updatedAt: new Date(timestampMs).toISOString()
  });

  updates.provenance = 'SIMULATED';
  updates.canonical = {
    telemetry: canonicalTelemetry,
    intersections: createNormalizedCollection(canonicalIntersections),
    devices: createNormalizedCollection(canonicalDevices),
    incidents: createNormalizedCollection(canonicalIncidents),
    emergencies: createNormalizedCollection(canonicalEmergencies)
  };

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
  if ('intersections' in payload && Array.isArray(payload.intersections)) updates.intersections = payload.intersections;
  if ('activeEmergencies' in payload && Array.isArray(payload.activeEmergencies)) updates.activeEmergencies = payload.activeEmergencies;

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
  const curCanonical = deepClone(curState.canonical || {});

  if (updates.telemetry) {
    curCanonical.telemetry = normalizeCanonicalTelemetry({
      ...curState.telemetry,
      ...updates.telemetry,
      source,
      provenance: 'SIMULATED',
      updatedAt: new Date(now).toISOString()
    });
  }

  if (updates.intersections && Array.isArray(updates.intersections)) {
    curCanonical.intersections = createNormalizedCollection(updates.intersections.map(normalizeCanonicalIntersection));
  }

  if (updates.activeEmergencies && Array.isArray(updates.activeEmergencies)) {
    curCanonical.emergencies = createNormalizedCollection(updates.activeEmergencies.map(normalizeCanonicalEmergency));
  }

  updates.canonical = curCanonical;
  stateStore.setState(updates, { source });
}

/**
 * Memperbarui State Sinyal APILL Persimpangan
 */
export function updateSignalState(nodeId, signalData, source = 'controller') {
  if (!validateAndTrackSequence(signalData, source, 'signal')) {
    return;
  }
  const incomingSeq = signalData.seq || signalData.sequence || 0;
  const currentIntersections = deepClone(stateStore.getState().intersections || []);
  let found = false;

  const updated = currentIntersections.map(node => {
    if (node.id === nodeId) {
      found = true;
      return { ...node, ...signalData };
    }
    return node;
  });

  if (found) {
    const curCanonical = deepClone(stateStore.getState().canonical || {});
    const canonicalList = updated.map(normalizeCanonicalIntersection);
    curCanonical.intersections = createNormalizedCollection(canonicalList);

    stateStore.setState({ 
      intersections: updated,
      canonical: curCanonical,
      lastReceivedSignalSequence: source === 'server' && incomingSeq > 0 ? incomingSeq : stateStore.getState().lastReceivedSignalSequence
    }, { source });
    stateStore.publish("signal:update", createEventEnvelope("signal:update", { nodeId, signalData, intersections: updated }, source));
  }
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
    updates.activeEmergencies = deepClone(payloadData.activeEmergencies);
  } else if (payloadData.item || payloadData.emergencyItem) {
    const item = payloadData.item || payloadData.emergencyItem;
    const list = deepClone(stateStore.getState().activeEmergencies || []);
    const existingIdx = list.findIndex(e => e.id === item.id || e.vehicleId === item.vehicleId);
    if (existingIdx >= 0) {
      list[existingIdx] = { ...list[existingIdx], ...item };
    } else {
      list.unshift(item);
    }
    if (list.length > 5) list.pop();
    updates.activeEmergencies = list;
  }

  const finalEmergencies = updates.activeEmergencies || stateStore.getState().activeEmergencies || [];
  const curCanonical = deepClone(stateStore.getState().canonical || {});
  curCanonical.emergencies = createNormalizedCollection(finalEmergencies.map(normalizeCanonicalEmergency));
  updates.canonical = curCanonical;

  stateStore.setState(updates, { source });
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
  const currentIncidents = deepClone(stateStore.getState().incidents || []);
  let found = false;
  const updated = currentIncidents.map(inc => {
    if (String(inc.id) === String(incidentId)) {
      found = true;
      return { ...inc, ...updateData };
    }
    return inc;
  });

  if (!found) {
    updated.unshift({ id: incidentId, ...updateData });
  }

  const curCanonical = deepClone(stateStore.getState().canonical || {});
  curCanonical.incidents = createNormalizedCollection(updated.map(normalizeCanonicalIncident));

  stateStore.setState({ 
    incidents: updated,
    canonical: curCanonical,
    lastReceivedIncidentSequence: source === 'server' && incomingSeq > 0 ? incomingSeq : stateStore.getState().lastReceivedIncidentSequence
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
  const currentDevices = deepClone(stateStore.getState().devices || []);
  const updated = currentDevices.map(dev => {
    if (dev.deviceId === deviceId) {
      return { ...dev, ...deviceData };
    }
    return dev;
  });

  const curCanonical = deepClone(stateStore.getState().canonical || {});
  curCanonical.devices = createNormalizedCollection(updated.map(normalizeCanonicalDevice));

  stateStore.setState({ 
    devices: updated,
    canonical: curCanonical,
    lastReceivedDeviceSequence: source === 'server' && incomingSeq > 0 ? incomingSeq : stateStore.getState().lastReceivedDeviceSequence
  }, { source });
  stateStore.publish("device:update", createEventEnvelope("device:update", { deviceId, deviceData, devices: updated }, source));
}

/**
 * Memperbarui State Telemetri Secara Spesifik
 */
export function updateTelemetryState(telemetryData, source = 'server') {
  const now = Date.now();
  const curCanonical = deepClone(stateStore.getState().canonical || {});
  curCanonical.telemetry = normalizeCanonicalTelemetry({
    ...telemetryData,
    source,
    provenance: 'SIMULATED',
    updatedAt: new Date(now).toISOString()
  });

  stateStore.setState({
    telemetry: telemetryData,
    canonical: curCanonical,
    lastTelemetryTime: now,
    lastTelemetryAt: now,
    lastTelemetrySource: source,
    isStaleData: source === 'server' ? false : stateStore.getState().isStaleData
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
  stateStore.setState({ 
    cctvVisionData: framePayload,
    lastReceivedCctvSequence: source === 'server' && incomingSeq > 0 ? incomingSeq : stateStore.getState().lastReceivedCctvSequence
  }, { source, emitGeneric: false });
  stateStore.publish("cctv:vision-update", createEventEnvelope("cctv:vision-update", framePayload, source));
}

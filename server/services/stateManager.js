import { ROUTES_DB } from '../config/constants.js';

const isTest = typeof global.it === 'function' || 
               typeof global.test === 'function' || 
               process.env.NODE_ENV === 'test' || 
               (process.env.DB_PATH && process.env.DB_PATH.includes('test')) ||
               process.env.PORT === '0';

if (isTest) {
  console.log = () => {};
  console.warn = () => {};
}

import { dbManager } from '../db/database.js';
import {
  INCIDENT_STATES,
  EMERGENCY_STATES,
  VALID_INCIDENT_STATUSES,
  VALID_EMERGENCY_STATUSES,
  normalizeIncidentStatus,
  normalizeEmergencyStatus,
  validateIncidentTransition,
  validateEmergencyTransition,
  createDomainEventEnvelope
} from '../config/stateMachine.js';
import { UnifiedClock, SIMULATION_MODES, systemClock } from './unifiedClock.js';
import { SAFETY_BOUNDARY } from '../config/safetyBoundary.js';
import { DeterministicRandomRegistry } from './seededRandom.js';
import { DeterministicSimulationEngine } from './simulationEngine.js';
import { validateDomainCommand, ContractValidationError } from '../config/contracts.js';
import {
  normalizeCanonicalTelemetry,
  normalizeCanonicalIntersection,
  normalizeCanonicalDevice,
  normalizeCanonicalIncident,
  normalizeCanonicalEmergency,
  createNormalizedCollection
} from '../config/domainModels.js';

export class BackendStateManager {
  constructor(options = {}) {
    this.clock = options.clock || systemClock;
    this.randomRegistry = options.randomRegistry || new DeterministicRandomRegistry(options.seed ?? 42);

    this.simConfig = {
      mode: options.mode || this.clock.mode || SIMULATION_MODES.LIVE,
      seed: options.seed ?? this.randomRegistry.masterSeed ?? 42,
      startTime: options.startTime ?? this.clock.now(),
      tickResolution: options.tickResolution || 1000,
      speedMultiplier: options.speedMultiplier || this.clock.speedMultiplier || 1.0,
      paused: options.paused !== undefined ? !!options.paused : this.clock.paused,
      timezone: 'Asia/Jakarta'
    };

    this.simEngine = options.simEngine || new DeterministicSimulationEngine({
      clock: this.clock,
      randomRegistry: this.randomRegistry,
      tickResolution: this.simConfig.tickResolution
    });
    this._simulationBaseline = null;
    this.simEngine.registerDomain('state-bootstrap', 10, () => this._beginSimulationTick(), {
      snapshot: () => this._snapshotSimulationState(),
      restore: snapshot => this._restoreSimulationState(snapshot),
      reset: () => this._resetSimulationState()
    });
    this.simEngine.registerDomain('device-telemetry', 20, context => this._stepDeviceTelemetry(context.deltaMs));
    this.simEngine.registerDomain('emergency-response', 30, context => this._stepEmergencySimulation(context.deltaMs));
    this.simEngine.registerDomain('signal-cycle', 40, () => this._stepSignalSimulation());
    this.simEngine.registerDomain('state-finalize', 50, () => this._finishSimulationTick());

    this.sequence = 1;
    this.cctvSequence = 1;
    this.incidentSequence = 1;
    this.emergencySequence = 1;
    this.signalSequence = 1;
    this.deviceSequence = 1;
    this.lastUpdated = this.clock.now();
    this.vehiclesCountToday = 128540;
    this.co2SavedKg = 1420;
    this.fuelSavedLiters = 580;
    this.io = null;
    this.pendingSimulationEvents = [];
    this.processedCommands = new Map();

    this.auditLogs = [
      {
        operator: "SITS Intelligent Agent",
        action: "BOOTSTRAP",
        entity: "System",
        result: "ATCS Surabaya Server initialized successfully.",
        timestamp: new Date().toISOString()
      }
    ];


    this.devicesRegistry = [
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
    ];

    this.activeFaults = {};
    this.deviceAuditTrail = [];

    this.state = {
      seq: this.sequence,
      timestamp: this._getWibTimeString(),
      timestampMs: this.lastUpdated,
      source: 'server',
      networkLoad: 72,
      avgWaitTime: 42,
      congestionIndex: 62,
      co2SavedKg: this.co2SavedKg,
      fuelSavedLiters: this.fuelSavedLiters,
      vehiclesToday: this.vehiclesCountToday,
      sitsUptime: 99.4,
      cctvOnline: 184,
      iotOnline: 312,
      sitsSignal: 94,
      aiScore: 92,
      aiConfidence: 96,
      
      // Control States
      isChaosMode: false,
      chaosLevel: 0,
      greenWaveActive: false,
      greenSplitWonokromo: 35,
      
      // Simulation metadata exposed in state
      simulation: {
        mode: this.simConfig.mode,
        seed: this.simConfig.seed,
        speedMultiplier: this.simConfig.speedMultiplier,
        paused: this.simConfig.paused,
        tickResolution: this.simConfig.tickResolution
      },

      // APILL Timers per Intersection
      intersections: [
        { id: "node-wonokromo", name: "Simpang Wonokromo", state: "green", timer: 35, greenSplit: 35, redDuration: 25, yellowDuration: 3, totalCycleTime: 63, cycleStartTime: this.clock.now(), waitTime: 42, status: "Normal", pendingGreenSplit: null, overrideStartTime: null, overrideDuration: 0 },
        { id: "node-jemursari", name: "Simpang Jemursari", state: "red", timer: 25, greenSplit: 28, redDuration: 25, yellowDuration: 3, totalCycleTime: 56, cycleStartTime: this.clock.now(), waitTime: 36, status: "Lancar", pendingGreenSplit: null, overrideStartTime: null, overrideDuration: 0 },
        { id: "node-darmo", name: "Simpang Raya Darmo", state: "green", timer: 42, greenSplit: 42, redDuration: 25, yellowDuration: 3, totalCycleTime: 70, cycleStartTime: this.clock.now(), waitTime: 28, status: "Lancar", pendingGreenSplit: null, overrideStartTime: null, overrideDuration: 0 },
        { id: "node-tunjungan", name: "Simpang Tunjungan", state: "yellow", timer: 3, greenSplit: 30, redDuration: 25, yellowDuration: 3, totalCycleTime: 58, cycleStartTime: this.clock.now(), waitTime: 48, status: "Padat", pendingGreenSplit: null, overrideStartTime: null, overrideDuration: 0 },
        { id: "node-merr", name: "Simpang MERR Kertajaya", state: "green", timer: 45, greenSplit: 45, redDuration: 25, yellowDuration: 3, totalCycleTime: 73, cycleStartTime: this.clock.now(), waitTime: 22, status: "Lancar", pendingGreenSplit: null, overrideStartTime: null, overrideDuration: 0 }
      ],

      // Stateful Incident Records
      incidents: [
        {
          id: "101",
          title: "Skenario kendaraan mogok",
          category: "accident",
          severity: "danger",
          location: "Simpang demo 01",
          coordinates: [-7.2985, 112.7345],
          reportedAt: new Date(Date.now() - 300000).toISOString(),
          updatedAt: new Date(Date.now() - 300000).toISOString(),
          status: "ACTIVE",
          priority: "high",
          source: "AI_VISION",
          assignedUnit: "Unit Demo",
          notes: "Skenario contoh; tidak ada petugas atau unit derek yang ditugaskan."
        },
        {
          id: "102",
          title: "Skenario genangan air",
          category: "weather",
          severity: "warning",
          location: "Koridor demo 02",
          coordinates: [-7.2725, 112.7690],
          reportedAt: new Date(Date.now() - 900000).toISOString(),
          updatedAt: new Date(Date.now() - 900000).toISOString(),
          status: "ACKNOWLEDGED",
          priority: "medium",
          source: "OPERATOR",
          assignedUnit: "Unit Demo",
          notes: "Skenario contoh genangan; bukan pengukuran atau laporan lapangan."
        },
        {
          id: "103",
          title: "Skenario antrean panjang",
          category: "congestion",
          severity: "warning",
          location: "Simpang demo 03",
          coordinates: [-7.3180, 112.7330],
          reportedAt: new Date(Date.now() - 600000).toISOString(),
          updatedAt: new Date(Date.now() - 600000).toISOString(),
          status: "ACTIVE",
          priority: "medium",
          source: "AI_VISION",
          assignedUnit: "Unit Demo",
          notes: "Antrean sintetis 180 meter pada skenario simulator."
        }
      ],

      // Active Emergency Priority Requests
      activeEmergencies: [],
      devices: this.devicesRegistry
    };

    this.yellowDuration = 3;
    this.redDurationBase = 25;
    this.resolutionInterval = null;
    this.isHydrated = false;
    this._initPromise = null;

    // Trigger asynchronous initialization
    this.init().catch(err => {
      console.error('❌ [State Manager] Inisialisasi awal database gagal:', err.message);
    });
  }

  setIo(io) {
    this.io = io;
  }

  async init() {
    if (this.isHydrated) return this;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      try {
        await dbManager.init();

        // 0. Restore & Protect Sequence Monotonicity Across Restarts
        const savedSeq = dbManager.getMetadata('last_persisted_sequence');
        if (savedSeq) {
          const parsed = parseInt(savedSeq, 10);
          if (!isNaN(parsed) && parsed >= this.sequence) {
            this.sequence = parsed + 10;
            this.incidentSequence = this.sequence;
            this.emergencySequence = this.sequence;
            this.signalSequence = this.sequence;
            this.deviceSequence = this.sequence;
            this.state.seq = this.sequence;
            console.log(`🗄️ [State Manager] Sequence dikalibrasi ulang dari baseline database: ${this.sequence}`);
          }
        }

        // 1. Deterministic Hydration: Incidents (Database is authoritative)
        const incRes = dbManager.getAllIncidents();
        const dbIncidents = Array.isArray(incRes) ? incRes : (incRes?.data || []);
        if (dbIncidents && dbIncidents.length > 0) {
          const incidentMap = new Map();
          dbIncidents.forEach(inc => incidentMap.set(String(inc.id), inc));

          // Merge any pre-configured seed not yet present in SQLite
          (this.state.incidents || []).forEach(seed => {
            if (!incidentMap.has(String(seed.id))) {
              try {
                dbManager.upsertIncident(seed);
                incidentMap.set(String(seed.id), seed);
              } catch (_) {}
            }
          });
          this.state.incidents = Array.from(incidentMap.values());
          console.log(`🗄️ [State Manager] Memuat & memulihkan ${this.state.incidents.length} insiden dari SQLite.`);
        } else {
          // Fresh database: persist initial seed incidents
          this.state.incidents.forEach(inc => {
            try { dbManager.upsertIncident(inc); } catch (_) {}
          });
        }

        // 2. Deterministic Hydration: Audit Logs (Deduplicated with Stable Identifiers)
        const logRes = dbManager.getAllAuditLogs(100);
        const dbLogs = Array.isArray(logRes) ? logRes : (logRes?.data || []);
        if (dbLogs && dbLogs.length > 0) {
          const knownCorrs = new Set();
          const mergedLogs = [];
          dbLogs.forEach(l => {
            const key = l.correlationId || `${l.timestamp}-${l.action}-${l.entity}`;
            if (!knownCorrs.has(key)) {
              knownCorrs.add(key);
              mergedLogs.push(l);
            }
          });
          this.auditLogs = mergedLogs;
        } else {
          this.auditLogs.forEach(log => {
            try { dbManager.insertAuditLog(log); } catch (_) {}
          });
        }

        // 3. Hydrate Signal Configs
        const sigRes = dbManager.getAllSignalConfigs();
        const dbSignals = Array.isArray(sigRes) ? sigRes : (sigRes?.data || []);
        if (dbSignals && dbSignals.length > 0) {
          dbSignals.forEach(cfg => {
            const node = this.state.intersections.find(n => n.id === cfg.node_id);
            if (node) {
              node.greenSplit = Number(cfg.green_split) || 35;
            }
            if (cfg.node_id === 'node-wonokromo') {
              this.state.greenSplitWonokromo = Number(cfg.green_split) || 35;
            }
          });
        } else {
          this.state.intersections.forEach(node => {
            try {
              dbManager.upsertSignalConfig(node.id, {
                greenSplit: node.greenSplit || 35,
                cycleTime: 90,
                mode: 'ADAPTIVE_AI'
              });
            } catch (_) {}
          });
        }

        // 4. Hydrate Device Configs & Recover with Safe Defaults
        const devRes = dbManager.getAllDeviceTelemetry();
        const dbDevices = Array.isArray(devRes) ? devRes : (devRes?.data || []);
        if (dbDevices && dbDevices.length > 0) {
          dbDevices.forEach(dbDev => {
            const idx = this.devicesRegistry.findIndex(d => d.deviceId === dbDev.deviceId);
            if (idx >= 0) {
              this.devicesRegistry[idx] = {
                ...this.devicesRegistry[idx],
                fps: dbDev.fps !== undefined && dbDev.fps !== null ? Number(dbDev.fps) : this.devicesRegistry[idx].fps,
                resolution: dbDev.resolution || this.devicesRegistry[idx].resolution,
                mode: dbDev.mode || this.devicesRegistry[idx].mode,
                greenWaveSync: dbDev.greenWaveSync !== undefined && dbDev.greenWaveSync !== null ? !!dbDev.greenWaveSync : this.devicesRegistry[idx].greenWaveSync
              };
            }
          });
        } else {
          this.devicesRegistry.forEach(dev => {
            try { dbManager.upsertDeviceTelemetry(dev); } catch (_) {}
          });
        }

        // 5. Emergency Recovery Guard: Do not leave orphaned active dispatches after crash
        if (Array.isArray(this.state.activeEmergencies)) {
          let hadActiveEmergency = false;
          this.state.activeEmergencies.forEach(emg => {
            if (["REQUESTED", "VERIFIED", "DISPATCHED", "EN_ROUTE"].includes(emg.status)) {
              emg.status = "CANCELLED_UPON_RESTART";
              emg.notes = "Server direstart saat dispatch armada berlangsung. Jalur sinyal dikembalikan ke siklus adaptif aman.";
              emg.updatedAt = new Date().toISOString();
              hadActiveEmergency = true;
            }
          });

          if (hadActiveEmergency) {
            this.state.greenWaveActive = false;
            this.recordAuditLog({
              operator: "SITS Crash Recovery",
              action: "EMERGENCY_RECOVERY_RESET",
              entity: "Active Emergencies",
              result: "RECOVERED (Reset to safe baseline)",
              timestamp: new Date().toISOString()
            });
          }
        }

        this.isHydrated = true;
        this._simulationBaseline = this._snapshotSimulationState();
        return this;
      } catch (err) {
        console.error('❌ [State Manager] Gagal menginisialisasi SQLite persistence:', err);
        throw err;
      } finally {
        this._initPromise = null;
      }
    })();

    return this._initPromise;
  }

  recordAuditLog(logEntry) {
    if (!logEntry) return;

    const nowIso = new Date().toISOString();
    const stableCorrId = logEntry.correlationId || logEntry.commandId || `AUD-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const normalizedLog = {
      ...logEntry,
      correlationId: stableCorrId,
      timestamp: logEntry.timestamp || nowIso
    };

    // Deduplication check: Avoid adding exact duplicate correlation
    const existingIdx = this.auditLogs.findIndex(l => l.correlationId && l.correlationId === stableCorrId);
    if (existingIdx >= 0) {
      this.auditLogs[existingIdx] = normalizedLog;
    } else {
      this.auditLogs.unshift(normalizedLog);
      if (this.auditLogs.length > 200) this.auditLogs.pop();
    }

    try {
      dbManager.insertAuditLog(normalizedLog);
    } catch (e) {
      console.error("❌ [Audit Log] Gagal menyimpan log audit:", e.message);
    }
  }

  _getWibTimeString() {
    return this.clock.nowWibString();
  }

  tickDevices() {
    const isChaos = this.state.isChaosMode;
    const now = this.clock.now();
    const devPrng = this.randomRegistry.getStream('devices');

    this.devicesRegistry.forEach(dev => {
      const fault = this.activeFaults ? this.activeFaults[dev.deviceId] : null;

      let targetLatency = isChaos ? 45 + Math.floor(Math.sin(now / 10000) * 15) : 8 + Math.floor(Math.sin(now / 15000) * 4);
      if (dev.deviceId === "NODE-EDGE-03") targetLatency += 6;
      if (dev.deviceId === "NODE-CTRL-01") targetLatency -= 3;

      let targetPacketLoss = isChaos ? 8 : 0;
      let targetFps = dev.deviceId === "NODE-CTRL-01" ? 0 : isChaos ? 15 : 28 + Math.floor(Math.sin(now / 8000) * 2);
      let targetTemp = isChaos ? 72 + Math.floor(Math.sin(now / 20000) * 4) : 40 + Math.floor(Math.sin(now / 25000) * 3);
      if (dev.deviceId === "NODE-EDGE-03") targetTemp += 20;

      let targetCpu = isChaos ? 82 + Math.floor(Math.sin(now / 5000) * 5) : 45 + Math.floor(Math.sin(now / 10000) * 5);
      let targetMem = isChaos ? 75 + Math.floor(Math.sin(now / 30000) * 2) : 48 + Math.floor(Math.sin(now / 40000) * 1);

      let source = "REALTIME-DERIVED";
      if (fault) {
        source = "SIMULATED";
        if (fault.type === "latency_spike") {
          targetLatency = 150;
          targetPacketLoss = 25;
        } else if (fault.type === "packet_loss") {
          targetPacketLoss = 45;
          targetLatency = 85;
        } else if (fault.type === "low_fps") {
          targetFps = 8;
        } else if (fault.type === "thermal_warning") {
          targetTemp = 88;
          targetCpu = 95;
        } else if (fault.type === "heartbeat_timeout") {
          targetLatency = 999;
          targetPacketLoss = 100;
          targetFps = 0;
        }
      }

      const alpha = 0.15;
      dev.latencyMs = Math.round(alpha * targetLatency + (1 - alpha) * dev.latencyMs);
      dev.packetLossPercent = Math.round(alpha * targetPacketLoss + (1 - alpha) * dev.packetLossPercent);
      if (dev.fps > 0 || targetFps > 0) {
        dev.fps = Math.round(alpha * targetFps + (1 - alpha) * dev.fps);
      }
      dev.temperatureC = Math.round(alpha * targetTemp + (1 - alpha) * dev.temperatureC);
      dev.cpuPercent = Math.round(alpha * targetCpu + (1 - alpha) * dev.cpuPercent);
      dev.memoryPercent = Math.round(alpha * targetMem + (1 - alpha) * dev.memoryPercent);

      dev.lastSeenAt = new Date(now).toISOString();
      if (fault && fault.type === "heartbeat_timeout") {
        dev.consecutiveFailures = Math.min(10, dev.consecutiveFailures + 1);
      } else {
        dev.lastHeartbeatAt = new Date(now).toISOString();
        dev.consecutiveFailures = 0;
      }

      dev.history.push(dev.latencyMs);
      if (dev.history.length > 10) {
        dev.history.shift();
      }

      let score = 100;
      if (dev.latencyMs > 40) {
        score -= Math.min(25, (dev.latencyMs - 40) * 0.4);
      }
      if (dev.packetLossPercent > 0) {
        score -= dev.packetLossPercent * 1.5;
      }
      if (dev.fps > 0 && dev.fps < 24) {
        score -= (24 - dev.fps) * 2.5;
      }
      if (dev.temperatureC > 70) {
        score -= (dev.temperatureC - 70) * 1.5;
      }
      if (dev.cpuPercent > 80) {
        score -= (dev.cpuPercent - 80) * 0.5;
      }
      if (dev.memoryPercent > 80) {
        score -= (dev.memoryPercent - 80) * 0.5;
      }

      const elapsedSinceHeartbeat = now - Date.parse(dev.lastHeartbeatAt);
      if (elapsedSinceHeartbeat > 12000 || dev.consecutiveFailures >= 5) {
        score = 0;
      } else if (elapsedSinceHeartbeat > 6000) {
        score -= 50;
      }

      dev.healthScore = Math.max(0, Math.min(100, Math.round(score)));

      const previousHealthLevel = dev.healthLevel;
      
      if (dev.healthScore === 0) {
        dev.healthLevel = "OFFLINE";
        dev.status = "OFFLINE";
      } else if (elapsedSinceHeartbeat > 6000) {
        dev.healthLevel = "STALE";
        dev.status = "STALE";
      } else if (dev.healthScore < 85 || dev.temperatureC > 75 || dev.packetLossPercent > 10 || (dev.fps > 0 && dev.fps < 15) || dev.latencyMs > 50) {
        dev.healthLevel = "DEGRADED";
        dev.status = "DEGRADED";
      } else {
        dev.healthLevel = "HEALTHY";
        dev.status = "ONLINE";
      }

      dev.source = source;
      dev.updatedAt = new Date(now).toISOString();

      if (dev.healthLevel !== previousHealthLevel) {
        this.handleDeviceTransition(dev, previousHealthLevel, dev.healthLevel);
      }
    });

    this.state.devices = this.devicesRegistry;
  }

  handleDeviceTransition(dev, oldLevel, newLevel) {
    const id = dev.deviceId;
    let existingInc = this.state.incidents.find(i => String(i.id) === `INC-${id}` || (i.notes && i.notes.includes(id) && i.status !== "RESOLVED"));
    const nowStr = this.clock.nowIso();
    const simTimestamp = this.clock.now();

    if (newLevel === "OFFLINE" || newLevel === "STALE") {
      const severity = newLevel === "OFFLINE" ? "danger" : "warning";
      if (existingInc) {
        existingInc.severity = severity;
        existingInc.title = `Kegagalan Jaringan SITS: Edge Node ${id} ${newLevel}`;
        existingInc.updatedAt = nowStr;
        existingInc.notes = `Koneksi terputus. consecutiveFailures: ${dev.consecutiveFailures}. Terakhir aktif: ${dev.lastHeartbeatAt}.`;
        this.incidentSequence++;
        this._queueSimulationEvent('incident:update', {
            id: existingInc.id,
            seq: this.incidentSequence,
            incidentSeq: this.incidentSequence,
            source: 'server',
            payload: existingInc
        });
      } else {
        const newInc = {
          id: `INC-${id}`,
          title: `Kegagalan Jaringan SITS: Edge Node ${id} ${newLevel}`,
          category: "accident",
          severity: severity,
          location: dev.location,
          coordinates: dev.coordinates,
          reportedAt: nowStr,
          updatedAt: nowStr,
          status: "ACTIVE",
          priority: "high",
          source: "AI_VISION",
          assignedUnit: "SITS Pemeliharaan Infrastruktur",
          notes: `Perangkat ${id} kehilangan koneksi. Status: ${newLevel}.`
        };
        this.state.incidents.unshift(newInc);
        this.incidentSequence++;
        this._queueSimulationEvent('incident:update', {
            id: newInc.id,
            seq: this.incidentSequence,
            incidentSeq: this.incidentSequence,
            source: 'server',
            payload: newInc
        });
      }

      this._queueSimulationEvent('system:toast', {
        message: `⚠️ GANGGUAN JARINGAN: Edge Node ${id} sekarang ${newLevel}!`,
        type: 'danger'
      });
    } else if (newLevel === "DEGRADED") {
      if (existingInc) {
        existingInc.severity = "warning";
        existingInc.title = `Anomali Edge Node SITS: ${id} Terdegradasi`;
        existingInc.updatedAt = nowStr;
        existingInc.notes = `Kinerja menurun. Temp: ${dev.temperatureC}°C, FPS: ${dev.fps}, Latency: ${dev.latencyMs}ms.`;
        this.incidentSequence++;
        this._queueSimulationEvent('incident:update', {
            id: existingInc.id,
            seq: this.incidentSequence,
            incidentSeq: this.incidentSequence,
            source: 'server',
            payload: existingInc
        });
      } else {
        const newInc = {
          id: `INC-${id}`,
          title: `Anomali Edge Node SITS: ${id} Terdegradasi`,
          category: "accident",
          severity: "warning",
          location: dev.location,
          coordinates: dev.coordinates,
          reportedAt: nowStr,
          updatedAt: nowStr,
          status: "ACTIVE",
          priority: "medium",
          source: "AI_VISION",
          assignedUnit: "SITS Pemeliharaan Infrastruktur",
          notes: `Kinerja ${id} terdegradasi. Temp: ${dev.temperatureC}°C, FPS: ${dev.fps}, Latency: ${dev.latencyMs}ms.`
        };
        this.state.incidents.unshift(newInc);
        this.incidentSequence++;
        this._queueSimulationEvent('incident:update', {
            id: newInc.id,
            seq: this.incidentSequence,
            incidentSeq: this.incidentSequence,
            source: 'server',
            payload: newInc
        });
      }

      this._queueSimulationEvent('system:toast', {
        message: `⚠️ PENURUNAN KINERJA: Edge Node ${id} terdegradasi!`,
        type: 'warning'
      });
    } else if (newLevel === "HEALTHY") {
      if (existingInc) {
        existingInc.status = "RESOLVED";
        existingInc.updatedAt = nowStr;
        existingInc.resolvedAt = nowStr;
        existingInc.notes += ` [PULIH] Node kembali ke status HEALTHY pada ${nowStr}.`;
        this.incidentSequence++;
        this._queueSimulationEvent('incident:update', {
            id: existingInc.id,
            seq: this.incidentSequence,
            incidentSeq: this.incidentSequence,
            source: 'server',
            payload: existingInc
        });
        
        this._queueSimulationEvent('system:toast', {
          message: `✅ KONEKSI PULIH: Edge Node ${id} kembali normal (HEALTHY).`,
          type: 'success'
        });
      }
    }
  }

  getSnapshot() {
    const canonicalTelemetry = normalizeCanonicalTelemetry({
      ...this.state,
      source: 'server',
      provenance: 'SIMULATED',
      updatedAt: this.clock.nowIso()
    });
    const canonicalIntersections = (this.state.intersections || []).map(normalizeCanonicalIntersection);
    const canonicalDevices = (this.state.devices || []).map(normalizeCanonicalDevice);
    const canonicalIncidents = (this.state.incidents || []).map(normalizeCanonicalIncident);
    const canonicalEmergencies = (this.state.activeEmergencies || []).map(normalizeCanonicalEmergency);

    const intersectionsCollection = createNormalizedCollection(canonicalIntersections);
    const devicesCollection = createNormalizedCollection(canonicalDevices);
    const incidentsCollection = createNormalizedCollection(canonicalIncidents);
    const emergenciesCollection = createNormalizedCollection(canonicalEmergencies);

    return {
      seq: this.sequence,
      cctvSeq: this.cctvSequence,
      incidentSeq: this.incidentSequence,
      emergencySeq: this.emergencySequence,
      signalSeq: this.signalSequence,
      deviceSeq: this.deviceSequence,
      timestamp: this.lastUpdated,
      isoTime: this.clock.nowIso(),
      source: 'server',
      provenance: 'SIMULATED',
      safetyBoundary: SAFETY_BOUNDARY,
      simConfig: { ...this.simConfig, mode: this.clock.mode, paused: this.clock.paused, speedMultiplier: this.clock.speedMultiplier },
      canonical: {
        telemetry: canonicalTelemetry,
        intersections: intersectionsCollection,
        devices: devicesCollection,
        incidents: incidentsCollection,
        emergencies: emergenciesCollection
      },
      state: JSON.parse(JSON.stringify(this.state))
    };
  }

  tick(deltaMs = 1000, options = {}) {
    this.pendingSimulationEvents = [];
    const result = this.simEngine.step(deltaMs, options);
    this._dispatchSimulationEvents();
    return result.domainResults?.['state-finalize'] || this.state;
  }

  _queueSimulationEvent(name, payload) {
    this.pendingSimulationEvents.push({ name, payload });
    this.simEngine.recordEvent({
      type: 'domain.transition',
      source: 'simulation',
      domain: 'state-manager',
      payload: { eventName: name, eventPayload: payload }
    });
  }

  _dispatchSimulationEvents() {
    if (!this.io || this.pendingSimulationEvents.length === 0) return;
    const events = this.pendingSimulationEvents.splice(0);
    for (const event of events) {
      const payload = event.name === 'incident:update' && event.payload && event.payload.timestamp === undefined
        ? { ...event.payload, timestamp: Date.now() }
        : event.payload;
      this.io.emit(event.name, payload);
    }
  }

  _snapshotSimulationState() {
    return cloneSimulationValue({
      state: this.state,
      devicesRegistry: this.devicesRegistry,
      activeFaults: this.activeFaults,
      deviceAuditTrail: this.deviceAuditTrail,
      sequence: this.sequence,
      cctvSequence: this.cctvSequence,
      incidentSequence: this.incidentSequence,
      emergencySequence: this.emergencySequence,
      signalSequence: this.signalSequence,
      deviceSequence: this.deviceSequence,
      lastUpdated: this.lastUpdated,
      vehiclesCountToday: this.vehiclesCountToday,
      co2SavedKg: this.co2SavedKg,
      fuelSavedLiters: this.fuelSavedLiters
    });
  }

  _restoreSimulationState(snapshot) {
    if (!snapshot || !snapshot.state || !Array.isArray(snapshot.devicesRegistry)) {
      throw new TypeError('invalid state-manager simulation snapshot');
    }
    for (const key of ['sequence', 'cctvSequence', 'incidentSequence', 'emergencySequence', 'signalSequence', 'deviceSequence', 'lastUpdated', 'vehiclesCountToday', 'co2SavedKg', 'fuelSavedLiters']) {
      if (!Number.isFinite(snapshot[key])) throw new TypeError(`invalid state-manager snapshot field '${key}'`);
    }
    const restored = cloneSimulationValue(snapshot);
    this.state = restored.state;
    this.devicesRegistry = restored.devicesRegistry;
    this.state.devices = this.devicesRegistry;
    this.activeFaults = restored.activeFaults || {};
    this.deviceAuditTrail = restored.deviceAuditTrail || [];
    for (const key of ['sequence', 'cctvSequence', 'incidentSequence', 'emergencySequence', 'signalSequence', 'deviceSequence', 'lastUpdated', 'vehiclesCountToday', 'co2SavedKg', 'fuelSavedLiters']) {
      this[key] = restored[key];
    }
    return this.state;
  }

  _resetSimulationState() {
    if (!this._simulationBaseline) throw new Error('simulation baseline is unavailable before state hydration');
    const current = this._snapshotSimulationState();
    this._restoreSimulationState(this._simulationBaseline);

    // Keep durable/operator-owned records and monotonic command sequences.
    this.state.incidents = current.state.incidents;
    this.sequence = Math.max(current.sequence, this.sequence);
    this.incidentSequence = Math.max(current.incidentSequence, this.incidentSequence);
    this.emergencySequence = Math.max(current.emergencySequence, this.emergencySequence);
    this.signalSequence = Math.max(current.signalSequence, this.signalSequence);
    this.deviceSequence = Math.max(current.deviceSequence, this.deviceSequence);
    this.cctvSequence = Math.max(current.cctvSequence, this.cctvSequence);
    this.state.seq = this.sequence;

    const currentNodes = new Map(current.state.intersections.map(node => [node.id, node]));
    this.state.intersections.forEach(node => {
      const persistedNode = currentNodes.get(node.id);
      if (!persistedNode) return;
      node.greenSplit = persistedNode.greenSplit;
      node.pendingGreenSplit = persistedNode.pendingGreenSplit;
    });
    this.state.greenSplitWonokromo = current.state.greenSplitWonokromo;

    const currentDevices = new Map(current.devicesRegistry.map(device => [device.deviceId, device]));
    this.devicesRegistry.forEach(device => {
      const persistedDevice = currentDevices.get(device.deviceId);
      if (!persistedDevice) return;
      for (const key of ['fps', 'resolution', 'mode', 'greenWaveSync']) {
        if (persistedDevice[key] !== undefined) device[key] = persistedDevice[key];
      }
    });
    this.state.devices = this.devicesRegistry;
    this.simConfig.seed = this.randomRegistry.masterSeed;
    this.simConfig.mode = this.clock.mode;
    this.simConfig.speedMultiplier = this.clock.speedMultiplier;
    this.simConfig.paused = this.clock.paused;
    this.lastUpdated = this.clock.now();
    this.state.timestampMs = this.lastUpdated;
    this.state.timestamp = this._getWibTimeString();
    this.state.simulation = {
      mode: this.clock.mode,
      seed: this.simConfig.seed,
      speedMultiplier: this.clock.speedMultiplier,
      paused: this.clock.paused,
      tickResolution: this.simConfig.tickResolution
    };
    if (this.resolutionInterval) clearInterval(this.resolutionInterval);
    this.resolutionInterval = null;
    this.activeFaults = {};
    this.pendingSimulationEvents = [];
    return this.state;
  }

  _beginSimulationTick() {
    this.sequence++;
    this.lastUpdated = this.clock.now();
    this.state.seq = this.sequence;
    this.state.timestampMs = this.lastUpdated;
    this.state.timestamp = this._getWibTimeString();
  }

  _stepDeviceTelemetry(deltaMs) {
    const trafficPrng = this.randomRegistry.getStream('traffic');
    const chaosPrng = this.randomRegistry.getStream('chaos');
    // 2. Simulasikan kesehatan & telemetri device
    this.tickDevices();

    // Hitung reduksi AI confidence berdasarkan kesehatan node (Phase 4/5 integration)
    const offlineCount = this.devicesRegistry.filter(d => d.healthLevel === "OFFLINE" || d.healthLevel === "STALE").length;
    const degradedCount = this.devicesRegistry.filter(d => d.healthLevel === "DEGRADED").length;

    // Increment metrics naturally using deterministic domain PRNG
    const effectiveDeltaSec = Math.max(0.1, deltaMs / 1000);
    this.vehiclesCountToday += (Math.floor(trafficPrng.nextFloat() * 5) + 1) * effectiveDeltaSec;
    this.co2SavedKg += Number((trafficPrng.nextFloat() * 0.2).toFixed(2)) * effectiveDeltaSec;
    this.fuelSavedLiters += Number((trafficPrng.nextFloat() * 0.1).toFixed(2)) * effectiveDeltaSec;

    this.state.vehiclesToday = Math.round(this.vehiclesCountToday);
    this.state.co2SavedKg = Math.round(this.co2SavedKg);
    this.state.fuelSavedLiters = Math.round(this.fuelSavedLiters);

    // Chaos mode impact calculations using seeded PRNG
    if (this.state.isChaosMode) {
      this.state.networkLoad = Math.min(99, Math.max(88, Math.floor(94 + (chaosPrng.nextFloat() * 6 - 3))));
      this.state.avgWaitTime = Math.min(130, Math.max(95, Math.floor(118 + (chaosPrng.nextFloat() * 10 - 5))));
      this.state.congestionIndex = Math.min(98, Math.max(85, Math.floor(92 + (chaosPrng.nextFloat() * 6 - 3))));
      this.state.sitsUptime = 42.5;
      this.state.cctvOnline = 72;
      this.state.iotOnline = 142;
      this.state.sitsSignal = 28;
      this.state.aiScore = 34;
      this.state.aiConfidence = Math.min(60, Math.max(35, Math.floor(45 + (chaosPrng.nextFloat() * 8 - 4))));
    } else {
      this.state.networkLoad = Math.min(92, Math.max(55, Math.floor(68 + (trafficPrng.nextFloat() * 8 - 4))));
      this.state.avgWaitTime = Math.min(65, Math.max(28, Math.floor(41 + (trafficPrng.nextFloat() * 6 - 3))));
      this.state.congestionIndex = Math.min(88, Math.max(45, Math.floor(60 + (trafficPrng.nextFloat() * 6 - 3))));
      this.state.sitsUptime = 99.4;
      this.state.cctvOnline = Math.max(120, 184 - (offlineCount * 12));
      this.state.iotOnline = Math.max(200, 312 - (offlineCount * 25));
      this.state.sitsSignal = Math.max(30, 94 - (offlineCount * 15) - (degradedCount * 5));
      this.state.aiScore = Math.max(20, 92 - (offlineCount * 10) - (degradedCount * 4));
      
      const normalConfidence = Math.min(99, Math.max(91, Math.floor(96 + (trafficPrng.nextFloat() * 3 - 1))));
      const confReduction = (offlineCount * 15) + (degradedCount * 5);
      this.state.aiConfidence = Math.max(10, normalConfidence - confReduction);
    }
  }

  _stepEmergencySimulation(deltaMs) {
    const effectiveDeltaSec = Math.max(0.1, deltaMs / 1000);
    // Advance Active Emergencies (Simulation Time Based)
    const emgNowIso = this.clock.nowIso();
    const emgNowMs = this.clock.now();

    if (this.state.activeEmergencies && this.state.activeEmergencies.length > 0) {
      this.state.activeEmergencies.forEach((emg) => {
        const route = ROUTES_DB[emg.routeId];
        if (["REQUESTED", "VERIFIED", "DISPATCHED", "EN_ROUTE", "ARRIVED"].includes(emg.status) && !route) return;
        if (emg.status === "REQUESTED") {
          emg.status = "VERIFIED";
          emg.updatedAt = emgNowIso;
        } else if (emg.status === "VERIFIED") {
          emg.status = "DISPATCHED";
          emg.updatedAt = emgNowIso;
        } else if (emg.status === "DISPATCHED") {
          emg.status = "EN_ROUTE";
          emg.updatedAt = emgNowIso;
          this._queueSimulationEvent('emergency:dispatch-alert', emg);
        } else if (emg.status === "EN_ROUTE") {
          const speedFactor = this.state.isChaosMode ? 0.6 : 1.0;
          emg.speed = Math.round((this.state.isChaosMode ? 42 : 65) + Math.sin(emgNowMs / 1000) * 5);

          // Progress scales with deltaSec so lag or variable tick step does not affect progression
          emg.progress += (0.025 * speedFactor) * effectiveDeltaSec;

          if (emg.progress >= 1.0) {
            emg.progress = 1.0;
            emg.status = "ARRIVED";
            emg.ETA = "0s";
            emg.currentPosition = [route[route.length - 1].lat, route[route.length - 1].lng];
            emg.updatedAt = emgNowIso;
            emg.holdTicks = 0;

            this.recordAuditLog({
              operator: "SITS Automation",
              action: "TRANSITION_ARRIVED",
              entity: `Emergency ${emg.id}`,
              result: `SUCCESS (Vehicle ${emg.vehicleId} arrived at destination)`,
              timestamp: emgNowIso
            });

            this._queueSimulationEvent('system:toast', {
              message: `✅ DISPATCH BERHASIL: ${emg.vehicleId} (${emg.vehicleType}) telah sampai di RSUD Dr. Soetomo.`,
              type: 'success'
            });

            route.forEach(pt => {
              if (pt.isIntersection) {
                const node = this.state.intersections.find(n => n.id === pt.id);
                if (node && node.preemptionVehicleId === emg.id) {
                  node.state = "green";
                  node.timer = node.greenSplit || 35;
                  node.status = "Lancar";
                  delete node.isPreempted;
                  delete node.preemptionVehicleId;
                }
              }
            });
          } else {
            const numSegs = route.length - 1;
            const totalProgress = emg.progress * numSegs;
            const segIndex = Math.min(numSegs - 1, Math.floor(totalProgress));
            const segFraction = totalProgress - segIndex;

            const p1 = route[segIndex];
            const p2 = route[segIndex + 1];

            const lat = p1.lat + (p2.lat - p1.lat) * segFraction;
            const lng = p1.lng + (p2.lng - p1.lng) * segFraction;

            emg.currentPosition = [lat, lng];
            emg.updatedAt = emgNowIso;

            const remainingRatio = 1 - emg.progress;
            const etaSec = Math.round(remainingRatio * 165);
            emg.ETA = `${Math.floor(etaSec / 60)}m ${etaSec % 60}s`;

            let nextIntName = "RSUD Dr. Soetomo (UGD)";
            let nextIntId = null;

            route.forEach((pt, idx) => {
              if (!pt.isIntersection) return;

              const dist = Math.sqrt(Math.pow(pt.lat - lat, 2) + Math.pow(pt.lng - lng, 2));

              if (idx > segIndex && !nextIntId) {
                nextIntId = pt.id;
                nextIntName = `Simpang ${pt.name.replace('Simpang ', '')}`;
              }

              if (dist <= 0.0019) {
                const node = this.state.intersections.find(n => n.id === pt.id);
                if (node) {
                  if (node.status === "Manual Override" && !node.isPreempted) {
                    this._queueSimulationEvent('system:toast', {
                      message: `⚠️ KONFLIK PRIORITAS: Sinyal Darurat mengesampingkan Override Manual di ${node.name}!`,
                      type: 'warning'
                    });
                    this.recordAuditLog({
                      operator: "SITS Preemption Guard",
                      action: "CONFLICT_RESOLVED",
                      entity: node.id,
                      result: `EMERGENCY PREEMPTION OVERRODE MANUAL OVERRIDE`,
                      timestamp: emgNowIso
                    });
                  }

                  node.state = "green";
                  node.timer = "∞";
                  node.status = "Preemption Aktif";
                  node.isPreempted = true;
                  node.preemptionVehicleId = emg.id;
                }
              }

              if (segIndex > idx && dist > 0.0028) {
                const node = this.state.intersections.find(n => n.id === pt.id);
                if (node && node.preemptionVehicleId === emg.id) {
                  node.state = "green";
                  node.timer = node.greenSplit || 35;
                  node.status = "Normal";
                  delete node.isPreempted;
                  delete node.preemptionVehicleId;
                }
              }
            });

            emg.nextIntersection = nextIntName;
          }
        } else if (emg.status === "ARRIVED") {
          emg.holdTicks = (emg.holdTicks || 0) + 1;
          if (emg.holdTicks >= 3) {
            emg.status = "COMPLETED";
            emg.updatedAt = emgNowIso;
            emg.holdTicks = 0;

            // Explicit cleanup of preemption across the route
            route.forEach(pt => {
              if (pt.isIntersection) {
                const node = this.state.intersections.find(n => n.id === pt.id);
                if (node && node.preemptionVehicleId === emg.id) {
                  node.state = "green";
                  node.timer = node.greenSplit || 35;
                  node.status = "Normal";
                  delete node.isPreempted;
                  delete node.preemptionVehicleId;
                }
              }
            });

            // Check if any other emergency is still active; if not, disable greenWaveActive
            const remainingActive = this.state.activeEmergencies.filter(
              e => e.id !== emg.id && !["COMPLETED", "CANCELLED", "TERMINAL_ARCHIVED"].includes(e.status)
            );
            if (remainingActive.length === 0) {
              this.state.greenWaveActive = false;
            }
          }
        } else if (emg.status === "COMPLETED" || emg.status === "CANCELLED") {
          emg.holdTicks = (emg.holdTicks || 0) + 1;
        }
      });

      this.state.activeEmergencies = this.state.activeEmergencies.filter(emg => {
        if (emg.status === "COMPLETED" || emg.status === "CANCELLED") {
          return (emg.holdTicks || 0) < 3;
        }
        return true;
      });

      // If activeEmergencies became empty, ensure greenWaveActive is false
      if (this.state.activeEmergencies.length === 0 && this.state.greenWaveActive) {
        this.state.greenWaveActive = false;
      }
    }
  }

  _stepSignalSimulation() {
    // Advance APILL Light Timers using Epoch Timestamp Synchronization (from this.clock.now())
    const nowMs = this.clock.now();
    this.state.intersections.forEach(node => {
      if (node.isPreempted) {
        node.state = "green";
        node.timer = "∞";
        node.status = "Preemption Aktif";
        return;
      }

      if (this.state.greenWaveActive && (node.id === "node-wonokromo" || node.id === "node-jemursari" || node.id === "node-darmo")) {
        node.state = "green";
        node.timer = "∞";
        node.status = "Green Wave";
        return;
      }

      // Check if Manual Override is Active
      if (node.overrideStartTime && node.overrideDuration > 0) {
        const elapsedOverrideSec = Math.floor((nowMs - node.overrideStartTime) / 1000);
        const remainingOverrideSec = node.overrideDuration - elapsedOverrideSec;

        if (remainingOverrideSec > 0) {
          node.state = "green";
          node.timer = remainingOverrideSec;
          node.status = `Manual Override (${remainingOverrideSec}s)`;
          node.isOverrideActive = true;
          return;
        } else {
          // Manual Override expired -> Smooth transition: MUST go to KUNING for yellowDuration before normal cycle
          node.isOverrideActive = false;
          node.overrideStartTime = null;
          node.overrideDuration = 0;
          node.state = "yellow";
          node.timer = node.yellowDuration || 3;
          node.status = "Transisi Setelah Override";
          // Reset cycleStartTime so normal cycle starts after yellow transition
          node.cycleStartTime = nowMs + ((node.yellowDuration || 3) * 1000);
          return;
        }
      }

      // Standard Adaptive Cycle Synchronization (Epoch Based)
      if (!node.cycleStartTime) {
        node.cycleStartTime = nowMs;
      }

      const yellowDur = node.yellowDuration || 3;
      const redDur = node.redDuration || 25;
      const greenDur = node.greenSplit || 35;
      const totalDur = greenDur + yellowDur + redDur;

      node.yellowDuration = yellowDur;
      node.redDuration = redDur;
      node.totalCycleTime = totalDur;

      const elapsedMs = Math.max(0, nowMs - node.cycleStartTime);
      const elapsedSec = Math.floor(elapsedMs / 1000);
      let cycleSec = elapsedSec % totalDur;

      // Smooth Cycle Transition: Apply pendingGreenSplit cleanly at start of cycle (cycleSec === 0)
      if (cycleSec === 0 && node.pendingGreenSplit) {
        node.greenSplit = node.pendingGreenSplit;
        if (node.id === "node-wonokromo") {
          this.state.greenSplitWonokromo = node.pendingGreenSplit;
        }
        node.pendingGreenSplit = null;
        node.totalCycleTime = node.greenSplit + yellowDur + redDur;
        dbManager.upsertSignalConfig(node.id, {
          greenSplit: node.greenSplit,
          cycleTime: node.totalCycleTime,
          mode: 'AI_OPTIMIZED'
        });
      }

      // Determine phase strictly: HIJAU -> KUNING -> MERAH -> HIJAU
      const activeGreen = node.greenSplit || 35;
      const activeYellow = node.yellowDuration || 3;
      const activeTotal = activeGreen + activeYellow + (node.redDuration || 25);

      if (cycleSec < activeGreen) {
        node.state = "green";
        node.timer = activeGreen - cycleSec;
        node.status = this.state.isChaosMode ? "Merayap" : "Lancar";
      } else if (cycleSec < activeGreen + activeYellow) {
        node.state = "yellow";
        node.timer = (activeGreen + activeYellow) - cycleSec;
        node.status = "Transisi";
      } else {
        node.state = "red";
        node.timer = activeTotal - cycleSec;
        node.status = this.state.isChaosMode ? "Macet Total" : "Padat";
      }
    });
  }

  _finishSimulationTick() {
    // Mirror simulation metadata in state
    this.state.simulation = {
      mode: this.clock.mode,
      seed: this.simConfig.seed,
      speedMultiplier: this.clock.speedMultiplier,
      paused: this.clock.paused,
      tickResolution: this.simConfig.tickResolution
    };

    return this.state;
  }

  toggleChaos(active) {
    validateDomainCommand('chaos:toggle', 'global-network', { active });
    this.sequence++;
    this.lastUpdated = Date.now();
    this.state.seq = this.sequence;
    this.state.timestampMs = this.lastUpdated;
    this.state.isChaosMode = !!active;
    this.state.chaosLevel = active ? 4 : 0;

    if (active) {
      if (this.resolutionInterval) clearInterval(this.resolutionInterval);
      this.resolutionInterval = setInterval(() => {
        if (this.state.chaosLevel <= 1) {
          this.toggleChaos(false);
          if (this.io) {
            this.io.emit('system:toast', { message: 'State simulator kembali dari skenario gangguan.', type: 'info' });
            this.io.emit('traffic:update', this.state);
          }
        } else {
          this.sequence++;
          this.lastUpdated = Date.now();
          this.state.seq = this.sequence;
          this.state.timestampMs = this.lastUpdated;
          this.state.chaosLevel--;
          if (this.io) this.io.emit('traffic:update', this.state);
        }
      }, 5000);
    } else {
      if (this.resolutionInterval) {
        clearInterval(this.resolutionInterval);
        this.resolutionInterval = null;
      }
    }
    return this.state;
  }

  setGreenSplit(value, intersectionId) {
    const input = validateDomainCommand('green-split:update', intersectionId, { value });
    const node = this.state.intersections.find(n => n.id === intersectionId);
    if (!node) throw new ContractValidationError('NOT_FOUND', `Intersection '${intersectionId}' was not found.`, { field: 'targetId', expected: 'known intersection', actual: intersectionId, statusCode: 404 });
    this.sequence++;
    this.lastUpdated = Date.now();
    this.state.seq = this.sequence;
    this.state.timestampMs = this.lastUpdated;
    const val = input.value;
    node.pendingGreenSplit = val;
    if (intersectionId === "node-wonokromo") {
      this.state.greenSplitWonokromo = val;
    }
    return this.state;
  }

  toggleGreenWave(active) {
    validateDomainCommand('green-wave:toggle', 'corridor-ayani-darmo', { active });
    this.sequence++;
    this.lastUpdated = Date.now();
    this.state.seq = this.sequence;
    this.state.timestampMs = this.lastUpdated;
    this.state.greenWaveActive = !!active;
    if (active) {
      this.state.intersections.forEach(node => {
        if (node.id === "node-wonokromo" || node.id === "node-jemursari" || node.id === "node-darmo") {
          node.state = "green";
          node.timer = "∞";
          node.status = "Green Wave";
        }
      });
    } else {
      const wNode = this.state.intersections.find(n => n.id === "node-wonokromo");
      if (wNode) {
        wNode.state = "green";
        wNode.timer = this.state.greenSplitWonokromo;
      }
    }
    return this.state;
  }

  applyAiRecommendation(intersectionId, targetSplit) {
    const input = validateDomainCommand('ai:apply-recommendation', intersectionId, { targetSplit });
    const node = this.state.intersections.find(n => n.id === intersectionId);
    if (!node) throw new ContractValidationError('NOT_FOUND', `Intersection '${intersectionId}' was not found.`, { field: 'targetId', expected: 'known intersection', actual: intersectionId, statusCode: 404 });
    this.sequence++;
    this.lastUpdated = this.clock.now();
    this.state.seq = this.sequence;
    this.state.timestampMs = this.lastUpdated;
    const aiPrng = this.randomRegistry.getStream('prediction');
    const optimizedSplit = input.targetSplit ?? Math.floor(42 + aiPrng.nextFloat() * 8);
    
    // Smooth Cycle Transition: set pendingGreenSplit to apply cleanly on next cycle!
    node.pendingGreenSplit = optimizedSplit;

    this.state.aiScore = Math.min(99, this.state.aiScore + 2);
    this.state.avgWaitTime = Math.max(22, this.state.avgWaitTime - 4);

    return { state: this.state, optimizedSplit, nodeName: node.name, smoothTransitionScheduled: true };
  }

  signalOverride(intersectionId, duration) {
    const input = validateDomainCommand('signal:override', intersectionId, { duration });
    const node = this.state.intersections.find(n => n.id === intersectionId);
    if (!node) throw new ContractValidationError('NOT_FOUND', `Intersection '${intersectionId}' was not found.`, { field: 'targetId', expected: 'known intersection', actual: intersectionId, statusCode: 404 });
    const previousNodeState = {
      state: node.state, timer: node.timer, status: node.status,
      overrideStartTime: node.overrideStartTime, overrideDuration: node.overrideDuration,
      isOverrideActive: node.isOverrideActive
    };
    const previousSequence = this.sequence;
    const previousLastUpdated = this.lastUpdated;
    this.sequence++;
    this.lastUpdated = this.clock.now();
    this.state.seq = this.sequence;
    this.state.timestampMs = this.lastUpdated;
    
    const durSec = input.duration;
    node.overrideStartTime = this.clock.now();
    node.overrideDuration = durSec;
    node.isOverrideActive = true;
    node.state = "green";
    node.timer = durSec;
    node.status = `Manual Override (${durSec}s)`;

    try {
      dbManager.upsertSignalConfig(node.id, {
        greenSplit: durSec,
        cycleTime: durSec,
        mode: 'MANUAL_OVERRIDE'
      });
    } catch (err) {
      Object.assign(node, previousNodeState);
      this.sequence = previousSequence;
      this.lastUpdated = previousLastUpdated;
      this.state.seq = previousSequence;
      this.state.timestampMs = previousLastUpdated;
      throw new Error(`PERSISTENCE_FAILED: Gagal menyimpan override sinyal ke SQLite (${err.message})`);
    }

    return { state: this.state, nodeName: node.name, duration: durSec };
  }

  updateIncidentStatus(id, newStatus, assignedUnit = null, notes = null, options = {}) {
    const canonical = validateDomainCommand('incident:update-status', id, { status: newStatus, assignedUnit, notes });
    const cleanStatus = canonical.status;

    const inc = this.state.incidents.find(i => String(i.id) === String(id));
    if (!inc) {
      throw new ContractValidationError('NOT_FOUND', `Incident '${id}' was not found.`, { field: 'targetId', expected: 'known incident', actual: id, statusCode: 404 });
    }

    const oldStatus = normalizeIncidentStatus(inc.status);
    if (oldStatus === cleanStatus) {
      return inc;
    }

    // Formal State Machine Validation
    const transitionCheck = validateIncidentTransition(oldStatus, cleanStatus);
    if (!transitionCheck.valid) {
      throw new Error(`STATE_CONFLICT: ${transitionCheck.reason}`);
    }

    // Cross-module check: Cannot resolve incident while associated emergency is still actively responding
    if (cleanStatus === INCIDENT_STATES.RESOLVED && inc.associatedEmergencyId) {
      const activeEmg = (this.state.activeEmergencies || []).find(
        e => String(e.id) === String(inc.associatedEmergencyId) || String(e.vehicleId) === String(inc.associatedEmergencyId)
      );
      if (activeEmg && !["ARRIVED", "COMPLETED", "CANCELLED", "TERMINAL_ARCHIVED"].includes(activeEmg.status)) {
        throw new Error(`STATE_CONFLICT: Insiden #${id} tidak dapat diselesaikan karena armada tanggap darurat (${activeEmg.vehicleId}) masih berstatus aktif (${activeEmg.status}). Batalkan atau selesaikan dispatch terlebih dahulu.`);
      }
    }

    const previousSnapshot = {
      status: inc.status,
      updatedAt: inc.updatedAt,
      acknowledgedAt: inc.acknowledgedAt,
      resolvedAt: inc.resolvedAt,
      assignedUnit: inc.assignedUnit,
      notes: inc.notes,
      associatedEmergencyId: inc.associatedEmergencyId
    };

    const incNowIso = this.clock.nowIso();
    const incNowMs = this.clock.now();

    inc.status = cleanStatus;
    inc.updatedAt = incNowIso;
    if (cleanStatus === INCIDENT_STATES.ACKNOWLEDGED && !inc.acknowledgedAt) {
      inc.acknowledgedAt = incNowIso;
    } else if (cleanStatus === INCIDENT_STATES.RESOLVED && !inc.resolvedAt) {
      inc.resolvedAt = incNowIso;
    }
    if (assignedUnit) inc.assignedUnit = assignedUnit;
    if (notes) inc.notes = notes;
    if (options.associatedEmergencyId) inc.associatedEmergencyId = options.associatedEmergencyId;

    this.sequence++;
    this.incidentSequence++;
    this.lastUpdated = incNowMs;
    this.state.seq = this.sequence;
    this.state.timestampMs = this.lastUpdated;

    // Persist ke Database SQLite with immediate atomic save and rollback guard
    try {
      dbManager.upsertIncident(inc, true);
    } catch (err) {
      // Rollback in-memory mutation
      Object.assign(inc, previousSnapshot);
      this.sequence--;
      this.incidentSequence--;
      this.state.seq = this.sequence;
      console.error(`❌ [State Manager] Rollback insiden #${id} karena persistence failure:`, err.message);
      throw new Error(`PERSISTENCE_FAILED: Gagal menyimpan status insiden #${id} ke SQLite (${err.message})`);
    }

    const stableCorrId = options.correlationId || `STATUS-${id}-${cleanStatus}-${incNowMs}`;
    const logEntry = {
        operator: options.actor || "Operator Demo",
      action: `TRANSITION_${cleanStatus}`,
      entity: `Incident ${id}`,
      result: `SUCCESS (dari ${oldStatus} ke ${cleanStatus})`,
      correlationId: stableCorrId,
      timestamp: incNowIso
    };
    if (!options.commandManaged) this.recordAuditLog(logEntry);

    const domainEvent = createDomainEventEnvelope({
      entityId: id,
      entityType: 'incident',
      previousState: oldStatus,
      nextState: cleanStatus,
      commandId: options.commandId,
      correlationId: stableCorrId,
      actor: options.actor || "Operator Demo",
      reason: options.reason || `Status insiden diubah dari ${oldStatus} ke ${cleanStatus}`,
      sequence: this.incidentSequence,
      details: {
        assignedUnit: inc.assignedUnit,
        associatedEmergencyId: inc.associatedEmergencyId
      }
    });

    if (this.io) {
      this.io.emit('incident:update', {
        id: id,
        seq: this.incidentSequence,
        timestamp: incNowMs,
        source: 'server',
        payload: inc,
        event: domainEvent
      });

      this.io.emit('system:toast', {
        message: `🔔 Status Insiden #${id} diubah ke ${cleanStatus}.`,
        type: 'info'
      });
    }

    return inc;
  }

  activateEmergencyPriority(code, routeId, options = {}) {
    const canonical = validateDomainCommand('emergency:activate', code, { code, route: routeId, incidentId: options.incidentId || options.associatedIncidentId });
    code = canonical.code;
    routeId = canonical.route;
    const existing = this.state.activeEmergencies.find(
      emg => emg.vehicleId === code && !["COMPLETED", "CANCELLED", "TERMINAL_ARCHIVED"].includes(emg.status)
    );
    if (existing) {
      throw new Error(`KENDARAAN SUDAH DISPATCHED: ${code} saat ini sedang aktif di rute.`);
    }

    const route = ROUTES_DB[routeId];
    const id = options.emergencyId || `EMG-${Date.now().toString().slice(-4)}`;
    
    // Explicit cross-module linkage: check if an associated incident exists or can be resolved
    const associatedIncidentId = options.incidentId || options.associatedIncidentId || null;
    let linkedIncident = null;
    if (associatedIncidentId) {
      linkedIncident = this.state.incidents.find(i => String(i.id) === String(associatedIncidentId));
      if (!linkedIncident) throw new ContractValidationError('NOT_FOUND', `Incident '${associatedIncidentId}' was not found.`, { field: 'incidentId', expected: 'known incident', actual: associatedIncidentId, statusCode: 404 });
      if (linkedIncident) {
        linkedIncident.associatedEmergencyId = id;
        if (linkedIncident.status === INCIDENT_STATES.ACTIVE || linkedIncident.status === INCIDENT_STATES.ACKNOWLEDGED) {
          linkedIncident.status = INCIDENT_STATES.DISPATCHED;
          linkedIncident.assignedUnit = `${code} (${(code && (code.toLowerCase().includes("damkar") || code.toLowerCase().includes("pmk"))) ? "PMK" : "Ambulance"})`;
          linkedIncident.updatedAt = new Date().toISOString();
          try { dbManager.upsertIncident(linkedIncident, true); } catch (_) {}
        }
      }
    }

    const emgNowIso = this.clock.nowIso();
    const emgNowMs = this.clock.now();

    this.sequence++;
    this.emergencySequence++;
    this.lastUpdated = emgNowMs;
    this.state.seq = this.sequence;
    this.state.timestampMs = this.lastUpdated;

    const emergencyItem = {
      id: id,
      vehicleId: code,
      vehicleType: (code && (code.toLowerCase().includes("damkar") || code.toLowerCase().includes("pmk") || code.toLowerCase().includes("pemadam"))) ? "PMK" : "Ambulance",
      origin: route[0].name,
      destination: route[route.length - 1].name,
      routeId: routeId,
      status: EMERGENCY_STATES.REQUESTED,
      priority: "high",
      ETA: "165s",
      speed: 60,
      currentPosition: [route[0].lat, route[0].lng],
      nextIntersection: `Simpang ${route.find(p => p.isIntersection)?.name || 'Wonokromo'}`,
      activatedAt: emgNowIso,
      expiresAt: new Date(emgNowMs + 300000).toISOString(),
      assignedRoute: routeId,
      progress: 0,
      associatedIncidentId: associatedIncidentId || (linkedIncident ? linkedIncident.id : null),
      originalSignalStates: new Map() // Snapshot for deterministic rollback on completion/cancellation
    };

    // Snapshot current signals along the route before applying preemption
    route.forEach(pt => {
      if (pt.isIntersection) {
        const node = this.state.intersections.find(n => n.id === pt.id);
        if (node) {
          emergencyItem.originalSignalStates.set(node.id, {
            state: node.state,
            timer: node.timer,
            status: node.status,
            greenSplit: node.greenSplit
          });
        }
      }
    });

    this.state.activeEmergencies.unshift(emergencyItem);

    // Apply immediate green-wave corridor activation
    this.state.greenWaveActive = true;

    const domainEvent = createDomainEventEnvelope({
      entityId: id,
      entityType: 'emergency',
      previousState: null,
      nextState: EMERGENCY_STATES.REQUESTED,
      commandId: options.commandId,
      correlationId: options.correlationId,
      actor: options.actor || "Operator Demo",
      reason: `Dispatch darurat diaktifkan untuk kendaraan ${code} pada rute ${routeId}`,
      sequence: this.emergencySequence,
      details: {
        vehicleId: code,
        routeId,
        associatedIncidentId: emergencyItem.associatedIncidentId
      }
    });

    if (!options.commandManaged) this.recordAuditLog({
      operator: options.actor || "Operator Demo",
      action: "DISPATCH_REQUEST",
      entity: `Emergency ${id}`,
      result: `SUCCESS (Vehicle ${code} requested for ${routeId})`,
      correlationId: options.correlationId,
      timestamp: new Date().toISOString()
    });

    return { state: this.state, emergencyItem, domainEvent };
  }

  cancelEmergency(id, options = {}) {
    validateDomainCommand('emergency:cancel', id, { id });
    const emg = this.state.activeEmergencies.find(e => e.id === id || e.vehicleId === id);
    if (!emg) {
      throw new ContractValidationError('NOT_FOUND', `Emergency '${id}' was not found.`, { field: 'targetId', expected: 'known emergency', actual: id, statusCode: 404 });
    }

    if (["COMPLETED", "CANCELLED", "TERMINAL_ARCHIVED"].includes(emg.status)) {
      return this.state;
    }

    const route = ROUTES_DB[emg.routeId];
    if (!route) throw new ContractValidationError('INVALID_TARGET', `Emergency route '${emg.routeId}' is invalid.`, { field: 'routeId', expected: Object.keys(ROUTES_DB), actual: emg.routeId });

    const oldStatus = emg.status;
    emg.status = EMERGENCY_STATES.CANCELLED;
    emg.updatedAt = this.clock.nowIso();
    emg.holdTicks = 0;

    // Restore all pre-empted signals deterministically
    route.forEach(pt => {
      if (pt.isIntersection) {
        const node = this.state.intersections.find(n => n.id === pt.id);
        if (node && node.preemptionVehicleId === emg.id) {
          node.state = "green";
          node.timer = node.greenSplit || 35;
          node.status = "Normal";
          delete node.isPreempted;
          delete node.preemptionVehicleId;
        }
      }
    });

    // Check if there are other active emergencies; if none, deactivate green wave
    const remainingActive = this.state.activeEmergencies.filter(
      e => e.id !== emg.id && !["COMPLETED", "CANCELLED", "TERMINAL_ARCHIVED"].includes(e.status)
    );
    if (remainingActive.length === 0) {
      this.state.greenWaveActive = false;
    }

    this.sequence++;
    this.emergencySequence++;
    this.lastUpdated = this.clock.now();
    this.state.seq = this.sequence;
    this.state.timestampMs = this.lastUpdated;

    const domainEvent = createDomainEventEnvelope({
      entityId: emg.id,
      entityType: 'emergency',
      previousState: oldStatus,
      nextState: EMERGENCY_STATES.CANCELLED,
      commandId: options.commandId,
      correlationId: options.correlationId,
      actor: options.actor || "Operator Demo",
      reason: `Prioritas darurat #${emg.id} (${emg.vehicleId}) dibatalkan oleh operator.`,
      sequence: this.emergencySequence,
      details: {
        vehicleId: emg.vehicleId,
        associatedIncidentId: emg.associatedIncidentId
      }
    });

    if (!options.commandManaged) this.recordAuditLog({
      operator: options.actor || "Operator Demo",
      action: "DISPATCH_CANCEL",
      entity: `Emergency ${emg.id}`,
      result: `SUCCESS (Vehicle ${emg.vehicleId} cancelled by operator)`,
      correlationId: options.correlationId,
      timestamp: new Date().toISOString()
    });

    if (this.io) {
      this.io.emit('emergency:update', {
        seq: this.emergencySequence,
        timestamp: Date.now(),
        source: 'server',
        payload: {
          activeEmergencies: this.state.activeEmergencies,
          greenWaveActive: this.state.greenWaveActive
        },
        event: domainEvent
      });

      this.io.emit('traffic:update', this.state);

      this.io.emit('system:toast', {
        message: `🛑 DISPATCH DIBATALKAN: Prioritas darurat untuk ${emg.vehicleId} dihentikan.`,
        type: 'warning'
      });
    }

    return this.state;
  }
}

function cloneSimulationValue(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Map
    ? { __simulationType: 'Map', entries: Array.from(item.entries()) }
    : item), (_key, item) => item && item.__simulationType === 'Map' ? new Map(item.entries) : item);
}

export const backendState = new BackendStateManager();

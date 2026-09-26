import { ROUTES_DB } from '../config/constants.js';
import { dbManager } from '../db/database.js';

export class BackendStateManager {
  constructor() {
    this.sequence = 1;
    this.cctvSequence = 1;
    this.incidentSequence = 1;
    this.emergencySequence = 1;
    this.signalSequence = 1;
    this.deviceSequence = 1;
    this.lastUpdated = Date.now();
    this.vehiclesCountToday = 128540;
    this.co2SavedKg = 1420;
    this.fuelSavedLiters = 580;
    this.io = null;

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
        deviceName: "Jl. Tunjungan Node AI",
        type: "Jetson Xavier NX",
        location: "Jl. Tunjungan",
        coordinates: [-7.2585, 112.7388],
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
        deviceName: "SITS Controller 01 (Wonokromo)",
        type: "Edge PLC Siemens",
        location: "SITS Controller Wonokromo",
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
      
      // APILL Timers per Intersection
      intersections: [
        { id: "node-wonokromo", name: "Simpang Wonokromo", state: "green", timer: 35, greenSplit: 35, redDuration: 25, yellowDuration: 3, totalCycleTime: 63, cycleStartTime: Date.now(), waitTime: 42, status: "Normal", pendingGreenSplit: null, overrideStartTime: null, overrideDuration: 0 },
        { id: "node-margorejo", name: "Simpang Margorejo", state: "red", timer: 25, greenSplit: 28, redDuration: 25, yellowDuration: 3, totalCycleTime: 56, cycleStartTime: Date.now(), waitTime: 36, status: "Lancar", pendingGreenSplit: null, overrideStartTime: null, overrideDuration: 0 },
        { id: "node-darmo", name: "Simpang Raya Darmo", state: "green", timer: 42, greenSplit: 42, redDuration: 25, yellowDuration: 3, totalCycleTime: 70, cycleStartTime: Date.now(), waitTime: 28, status: "Lancar", pendingGreenSplit: null, overrideStartTime: null, overrideDuration: 0 },
        { id: "node-tunjungan", name: "Simpang Tunjungan", state: "yellow", timer: 3, greenSplit: 30, redDuration: 25, yellowDuration: 3, totalCycleTime: 58, cycleStartTime: Date.now(), waitTime: 48, status: "Padat", pendingGreenSplit: null, overrideStartTime: null, overrideDuration: 0 },
        { id: "node-merr", name: "Simpang MERR Kertajaya", state: "green", timer: 45, greenSplit: 45, redDuration: 25, yellowDuration: 3, totalCycleTime: 73, cycleStartTime: Date.now(), waitTime: 22, status: "Lancar", pendingGreenSplit: null, overrideStartTime: null, overrideDuration: 0 }
      ],

      // Stateful Incident Records
      incidents: [
        {
          id: "101",
          title: "Mogok Truk Treler",
          category: "accident",
          severity: "danger",
          location: "Simpang Wonokromo (DTC)",
          coordinates: [-7.2985, 112.7345],
          reportedAt: new Date(Date.now() - 300000).toISOString(),
          updatedAt: new Date(Date.now() - 300000).toISOString(),
          status: "ACTIVE",
          priority: "high",
          source: "AI_VISION",
          assignedUnit: "SITS Patroli Wilayah Selatan",
          notes: "Truk treler mogok di lajur tengah, sedang menunggu derek Dinas Perhubungan."
        },
        {
          id: "102",
          title: "Genangan Air Hujan (15cm)",
          category: "weather",
          severity: "warning",
          location: "Koridor Manyar Kertoarjo",
          coordinates: [-7.2725, 112.7690],
          reportedAt: new Date(Date.now() - 900000).toISOString(),
          updatedAt: new Date(Date.now() - 900000).toISOString(),
          status: "ACKNOWLEDGED",
          priority: "medium",
          source: "OPERATOR",
          assignedUnit: "BPBD Kota Surabaya",
          notes: "Genangan air setinggi 15cm terpantau di lajur lambat, tim BPBD mengoperasikan pompa portabel."
        },
        {
          id: "103",
          title: "Antrean Lampu Merah Panjang",
          category: "congestion",
          severity: "warning",
          location: "Simpang Jemursari - A. Yani",
          coordinates: [-7.3180, 112.7330],
          reportedAt: new Date(Date.now() - 600000).toISOString(),
          updatedAt: new Date(Date.now() - 600000).toISOString(),
          status: "ACTIVE",
          priority: "medium",
          source: "AI_VISION",
          assignedUnit: "Regu ATCS Surabaya Selatan",
          notes: "Antrean terdeteksi sepanjang 180 meter di frontage road Ahmad Yani."
        }
      ],

      // Active Emergency Priority Requests
      activeEmergencies: [],
      devices: this.devicesRegistry
    };

    this.yellowDuration = 3;
    this.redDurationBase = 25;
    this.resolutionInterval = null;

    // Inisialisasi Lapisan Persistensi SQLite
    this._initPersistence();
  }

  async _initPersistence() {
    try {
      await dbManager.init();

      // 1. Hydrate Incidents dari Database
      const dbIncidents = dbManager.getAllIncidents();
      if (dbIncidents && dbIncidents.length > 0) {
        this.state.incidents = dbIncidents;
        console.log(`🗄️ [State Manager] Memuat ${dbIncidents.length} insiden aktif/riwayat dari SQLite.`);
      } else {
        this.state.incidents.forEach(inc => dbManager.upsertIncident(inc));
      }

      // 2. Hydrate Audit Logs dari Database
      const dbLogs = dbManager.getAllAuditLogs(100);
      if (dbLogs && dbLogs.length > 0) {
        this.auditLogs = dbLogs;
      } else {
        this.auditLogs.forEach(log => dbManager.insertAuditLog(log));
      }

      // 3. Hydrate Signal Configs
      const dbSignals = dbManager.getAllSignalConfigs();
      if (dbSignals && dbSignals.length > 0) {
        dbSignals.forEach(cfg => {
          const node = this.state.intersections.find(n => n.id === cfg.node_id);
          if (node) {
            node.greenSplit = cfg.green_split;
          }
          if (cfg.node_id === 'node-wonokromo') {
            this.state.greenSplitWonokromo = cfg.green_split;
          }
        });
      } else {
        this.state.intersections.forEach(node => {
          dbManager.upsertSignalConfig(node.id, {
            greenSplit: node.greenSplit || 35,
            cycleTime: 90,
            mode: 'ADAPTIVE_AI'
          });
        });
      }

      // 4. Hydrate Device Telemetry
      const dbDevices = dbManager.getAllDeviceTelemetry();
      if (dbDevices && dbDevices.length > 0) {
        dbDevices.forEach(dbDev => {
          const idx = this.devicesRegistry.findIndex(d => d.deviceId === dbDev.deviceId);
          if (idx >= 0) {
            this.devicesRegistry[idx] = { ...this.devicesRegistry[idx], ...dbDev };
          }
        });
      } else {
        this.devicesRegistry.forEach(dev => dbManager.upsertDeviceTelemetry(dev));
      }
    } catch (err) {
      console.error('❌ [State Manager] Gagal menginisialisasi SQLite persistence:', err);
    }
  }

  recordAuditLog(logEntry) {
    if (!logEntry) return;
    this.auditLogs.unshift(logEntry);
    if (this.auditLogs.length > 200) this.auditLogs.pop();
    dbManager.insertAuditLog(logEntry);
  }

  setIo(ioInstance) {
    this.io = ioInstance;
  }

  tickDevices() {
    const isChaos = this.state.isChaosMode;
    const now = Date.now();

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
      dev.updatedAt = new Date().toISOString();

      if (dev.healthLevel !== previousHealthLevel) {
        this.handleDeviceTransition(dev, previousHealthLevel, dev.healthLevel);
      }
    });

    this.state.devices = this.devicesRegistry;
  }

  handleDeviceTransition(dev, oldLevel, newLevel) {
    const id = dev.deviceId;
    let existingInc = this.state.incidents.find(i => String(i.id) === `INC-${id}` || (i.notes && i.notes.includes(id) && i.status !== "RESOLVED"));
    const nowStr = new Date().toISOString();

    if (newLevel === "OFFLINE" || newLevel === "STALE") {
      const severity = newLevel === "OFFLINE" ? "danger" : "warning";
      if (existingInc) {
        existingInc.severity = severity;
        existingInc.title = `Kegagalan Jaringan SITS: Edge Node ${id} ${newLevel}`;
        existingInc.updatedAt = nowStr;
        existingInc.notes = `Koneksi terputus. consecutiveFailures: ${dev.consecutiveFailures}. Terakhir aktif: ${dev.lastHeartbeatAt}.`;
        if (this.io) this.io.emit('incident:update', { id: existingInc.id, payload: existingInc });
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
        if (this.io) this.io.emit('incident:update', { id: newInc.id, payload: newInc });
      }

      if (this.io) {
        this.io.emit('system:toast', {
          message: `⚠️ GANGGUAN JARINGAN: Edge Node ${id} sekarang ${newLevel}!`,
          type: 'danger'
        });
      }
    } else if (newLevel === "DEGRADED") {
      if (existingInc) {
        existingInc.severity = "warning";
        existingInc.title = `Anomali Edge Node SITS: ${id} Terdegradasi`;
        existingInc.updatedAt = nowStr;
        existingInc.notes = `Kinerja menurun. Temp: ${dev.temperatureC}°C, FPS: ${dev.fps}, Latency: ${dev.latencyMs}ms.`;
        if (this.io) this.io.emit('incident:update', { id: existingInc.id, payload: existingInc });
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
        if (this.io) this.io.emit('incident:update', { id: newInc.id, payload: newInc });
      }

      if (this.io) {
        this.io.emit('system:toast', {
          message: `⚠️ PENURUNAN KINERJA: Edge Node ${id} terdegradasi!`,
          type: 'warning'
        });
      }
    } else if (newLevel === "HEALTHY") {
      if (existingInc) {
        existingInc.status = "RESOLVED";
        existingInc.updatedAt = nowStr;
        existingInc.resolvedAt = nowStr;
        existingInc.notes += ` [PULIH] Node kembali ke status HEALTHY pada ${nowStr}.`;
        if (this.io) this.io.emit('incident:update', { id: existingInc.id, payload: existingInc });
        
        if (this.io) {
          this.io.emit('system:toast', {
            message: `✅ KONEKSI PULIH: Edge Node ${id} kembali normal (HEALTHY).`,
            type: 'success'
          });
        }
      }
    }
  }

  _getWibTimeString() {
    return new Date().toLocaleTimeString('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour12: false
    }) + ' WIB';
  }

  getSnapshot() {
    return {
      seq: this.sequence,
      timestamp: this.lastUpdated,
      isoTime: new Date().toISOString(),
      source: 'server',
      state: JSON.parse(JSON.stringify(this.state))
    };
  }

  tick() {
    this.sequence++;
    this.lastUpdated = Date.now();
    this.state.seq = this.sequence;
    this.state.timestampMs = this.lastUpdated;
    this.state.timestamp = this._getWibTimeString();

    // Simulasikan kesehatan & telemetri device
    this.tickDevices();

    // Hitung reduksi AI confidence berdasarkan kesehatan node (Phase 4/5 integration)
    const offlineCount = this.devicesRegistry.filter(d => d.healthLevel === "OFFLINE" || d.healthLevel === "STALE").length;
    const degradedCount = this.devicesRegistry.filter(d => d.healthLevel === "DEGRADED").length;

    // Increment metrics naturally
    this.vehiclesCountToday += Math.floor(Math.random() * 5) + 1;
    this.co2SavedKg += Number((Math.random() * 0.2).toFixed(2));
    this.fuelSavedLiters += Number((Math.random() * 0.1).toFixed(2));

    this.state.vehiclesToday = Math.round(this.vehiclesCountToday);
    this.state.co2SavedKg = Math.round(this.co2SavedKg);
    this.state.fuelSavedLiters = Math.round(this.fuelSavedLiters);

    // Chaos mode impact calculations
    if (this.state.isChaosMode) {
      this.state.networkLoad = Math.min(99, Math.max(88, Math.floor(94 + (Math.random() * 6 - 3))));
      this.state.avgWaitTime = Math.min(130, Math.max(95, Math.floor(118 + (Math.random() * 10 - 5))));
      this.state.congestionIndex = Math.min(98, Math.max(85, Math.floor(92 + (Math.random() * 6 - 3))));
      this.state.sitsUptime = 42.5;
      this.state.cctvOnline = 72;
      this.state.iotOnline = 142;
      this.state.sitsSignal = 28;
      this.state.aiScore = 34;
      this.state.aiConfidence = Math.min(60, Math.max(35, Math.floor(45 + (Math.random() * 8 - 4))));
    } else {
      this.state.networkLoad = Math.min(92, Math.max(55, Math.floor(68 + (Math.random() * 8 - 4))));
      this.state.avgWaitTime = Math.min(65, Math.max(28, Math.floor(41 + (Math.random() * 6 - 3))));
      this.state.congestionIndex = Math.min(88, Math.max(45, Math.floor(60 + (Math.random() * 6 - 3))));
      this.state.sitsUptime = 99.4;
      this.state.cctvOnline = Math.max(120, 184 - (offlineCount * 12));
      this.state.iotOnline = Math.max(200, 312 - (offlineCount * 25));
      this.state.sitsSignal = Math.max(30, 94 - (offlineCount * 15) - (degradedCount * 5));
      this.state.aiScore = Math.max(20, 92 - (offlineCount * 10) - (degradedCount * 4));
      
      const normalConfidence = Math.min(99, Math.max(91, Math.floor(96 + (Math.random() * 3 - 1))));
      const confReduction = (offlineCount * 15) + (degradedCount * 5);
      this.state.aiConfidence = Math.max(10, normalConfidence - confReduction);
    }

    // Advance Active Emergencies
    if (this.state.activeEmergencies && this.state.activeEmergencies.length > 0) {
      this.state.activeEmergencies.forEach((emg) => {
        if (emg.status === "REQUESTED") {
          emg.status = "VERIFIED";
          emg.updatedAt = new Date().toISOString();
        } else if (emg.status === "VERIFIED") {
          emg.status = "DISPATCHED";
          emg.updatedAt = new Date().toISOString();
        } else if (emg.status === "DISPATCHED") {
          emg.status = "EN_ROUTE";
          emg.updatedAt = new Date().toISOString();
          if (this.io) this.io.emit('emergency:dispatch-alert', emg);
        } else if (emg.status === "EN_ROUTE") {
          const route = ROUTES_DB[emg.routeId] || ROUTES_DB["route-soetomo"];
          const speedFactor = this.state.isChaosMode ? 0.6 : 1.0;
          emg.speed = Math.round((this.state.isChaosMode ? 42 : 65) + Math.sin(Date.now() / 1000) * 5);

          emg.progress += 0.025 * speedFactor;

          if (emg.progress >= 1.0) {
            emg.progress = 1.0;
            emg.status = "ARRIVED";
            emg.ETA = "0s";
            emg.currentPosition = [route[route.length - 1].lat, route[route.length - 1].lng];
            emg.updatedAt = new Date().toISOString();
            emg.holdTicks = 0;

            this.recordAuditLog({
              operator: "SITS Automation",
              action: "TRANSITION_ARRIVED",
              entity: `Emergency ${emg.id}`,
              result: `SUCCESS (Vehicle ${emg.vehicleId} arrived at destination)`,
              timestamp: new Date().toISOString()
            });

            if (this.io) {
              this.io.emit('system:toast', {
                message: `✅ DISPATCH BERHASIL: ${emg.vehicleId} (${emg.vehicleType}) telah sampai di RSUD Dr. Soetomo.`,
                type: 'success'
              });
            }

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
            emg.updatedAt = new Date().toISOString();

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
                    if (this.io) {
                      this.io.emit('system:toast', {
                        message: `⚠️ KONFLIK PRIORITAS: Sinyal Darurat mengesampingkan Override Manual di ${node.name}!`,
                        type: 'warning'
                      });
                    }
                    this.recordAuditLog({
                      operator: "SITS Preemption Guard",
                      action: "CONFLICT_RESOLVED",
                      entity: node.id,
                      result: `EMERGENCY PREEMPTION OVERRODE MANUAL OVERRIDE`,
                      timestamp: new Date().toISOString()
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
            emg.updatedAt = new Date().toISOString();
            emg.holdTicks = 0;
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
    }

    // Advance APILL Light Timers using Epoch Timestamp Synchronization
    const nowMs = Date.now();
    this.state.intersections.forEach(node => {
      if (node.isPreempted) {
        node.state = "green";
        node.timer = "∞";
        node.status = "Preemption Aktif";
        return;
      }

      if (this.state.greenWaveActive && (node.id === "node-wonokromo" || node.id === "node-margorejo" || node.id === "node-darmo")) {
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

    return this.state;
  }

  toggleChaos(active) {
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
            this.io.emit('system:toast', { message: 'Sistem ATCS Surabaya pulih otomatis dari Mode Keos.', type: 'info' });
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

  setGreenSplit(value, intersectionId = "node-wonokromo") {
    this.sequence++;
    this.lastUpdated = Date.now();
    this.state.seq = this.sequence;
    this.state.timestampMs = this.lastUpdated;
    const val = Math.min(90, Math.max(15, parseInt(value, 10) || 35));
    const node = this.state.intersections.find(n => n.id === intersectionId);
    if (node) {
      node.pendingGreenSplit = val;
      if (intersectionId === "node-wonokromo") {
        this.state.greenSplitWonokromo = val;
      }
    }
    return this.state;
  }

  toggleGreenWave(active) {
    this.sequence++;
    this.lastUpdated = Date.now();
    this.state.seq = this.sequence;
    this.state.timestampMs = this.lastUpdated;
    this.state.greenWaveActive = !!active;
    if (active) {
      this.state.intersections.forEach(node => {
        if (node.id === "node-wonokromo" || node.id === "node-margorejo" || node.id === "node-darmo") {
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

  applyAiRecommendation(intersectionId = "node-wonokromo", targetSplit = null) {
    this.sequence++;
    this.lastUpdated = Date.now();
    this.state.seq = this.sequence;
    this.state.timestampMs = this.lastUpdated;
    const node = this.state.intersections.find(n => n.id === intersectionId) || this.state.intersections[0];
    const optimizedSplit = targetSplit || Math.floor(42 + Math.random() * 8);
    
    // Smooth Cycle Transition: set pendingGreenSplit to apply cleanly on next cycle!
    node.pendingGreenSplit = optimizedSplit;

    this.state.aiScore = Math.min(99, this.state.aiScore + 2);
    this.state.avgWaitTime = Math.max(22, this.state.avgWaitTime - 4);

    return { state: this.state, optimizedSplit, nodeName: node.name, smoothTransitionScheduled: true };
  }

  signalOverride(intersectionId, duration = 45) {
    this.sequence++;
    this.lastUpdated = Date.now();
    this.state.seq = this.sequence;
    this.state.timestampMs = this.lastUpdated;
    const node = this.state.intersections.find(n => n.id === intersectionId) || this.state.intersections[0];
    
    const durSec = Math.min(90, Math.max(15, parseInt(duration, 10) || 45));
    node.overrideStartTime = Date.now();
    node.overrideDuration = durSec;
    node.isOverrideActive = true;
    node.state = "green";
    node.timer = durSec;
    node.status = `Manual Override (${durSec}s)`;

    dbManager.upsertSignalConfig(node.id, {
      greenSplit: durSec,
      cycleTime: durSec,
      mode: 'MANUAL_OVERRIDE'
    });

    return { state: this.state, nodeName: node.name, duration: durSec };
  }

  updateIncidentStatus(id, newStatus, assignedUnit = null, notes = null) {
    const validStatuses = ["ACTIVE", "ACKNOWLEDGED", "DISPATCHED", "RESPONDING", "DISPATCHED/RESPONDING", "MITIGATED", "RESOLVED", "ARCHIVED"];
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`Status ${newStatus} tidak valid.`);
    }

    const inc = this.state.incidents.find(i => String(i.id) === String(id));
    if (!inc) {
      throw new Error(`Insiden dengan ID ${id} tidak ditemukan.`);
    }

    const oldStatus = inc.status;
    if (oldStatus === newStatus) {
      return inc;
    }

    inc.status = newStatus;
    inc.updatedAt = new Date().toISOString();
    if (newStatus === "ACKNOWLEDGED") {
      inc.acknowledgedAt = new Date().toISOString();
    } else if (newStatus === "RESOLVED") {
      inc.resolvedAt = new Date().toISOString();
    }
    if (assignedUnit) inc.assignedUnit = assignedUnit;
    if (notes) inc.notes = notes;

    this.sequence++;
    this.state.seq = this.sequence;
    this.state.timestampMs = Date.now();

    // Persist ke Database SQLite
    dbManager.upsertIncident(inc);

    const logEntry = {
      operator: "Operator SITS 112 Surabaya",
      action: `TRANSITION_${newStatus}`,
      entity: `Incident ${id}`,
      result: `SUCCESS (dari ${oldStatus} ke ${newStatus})`,
      timestamp: new Date().toISOString()
    };
    this.recordAuditLog(logEntry);

    if (this.io) {
      this.io.emit('incident:update', {
        id: id,
        seq: this.sequence,
        timestamp: Date.now(),
        source: 'server',
        payload: inc
      });

      this.io.emit('system:toast', {
        message: `🔔 Status Insiden #${id} diubah ke ${newStatus}.`,
        type: 'info'
      });
    }

    return inc;
  }

  activateEmergencyPriority(code, routeId = "route-soetomo") {
    const existing = this.state.activeEmergencies.find(
      emg => emg.vehicleId === code && !["COMPLETED", "CANCELLED"].includes(emg.status)
    );
    if (existing) {
      throw new Error(`KENDARAAN SUDAH DISPATCHED: ${code} saat ini sedang aktif di rute.`);
    }

    this.sequence++;
    this.lastUpdated = Date.now();
    this.state.seq = this.sequence;
    this.state.timestampMs = this.lastUpdated;

    const route = ROUTES_DB[routeId] || ROUTES_DB["route-soetomo"];
    const id = `EMG-${Date.now().toString().slice(-4)}`;
    
    const emergencyItem = {
      id: id,
      vehicleId: code || "AMB-02",
      vehicleType: (code && (code.toLowerCase().includes("damkar") || code.toLowerCase().includes("pmk") || code.toLowerCase().includes("pemadam"))) ? "PMK" : "Ambulance",
      origin: route[0].name,
      destination: route[route.length - 1].name,
      routeId: routeId,
      status: "REQUESTED",
      priority: "high",
      ETA: "165s",
      speed: 60,
      currentPosition: [route[0].lat, route[0].lng],
      nextIntersection: `Simpang ${route.find(p => p.isIntersection)?.name || 'Wonokromo'}`,
      activatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      assignedRoute: routeId,
      progress: 0
    };

    this.state.activeEmergencies.unshift(emergencyItem);

    this.recordAuditLog({
      operator: "Operator SITS 112 Surabaya",
      action: "DISPATCH_REQUEST",
      entity: `Emergency ${id}`,
      result: `SUCCESS (Vehicle ${code} requested for ${routeId})`,
      timestamp: new Date().toISOString()
    });

    return { state: this.state, emergencyItem };
  }

  cancelEmergency(id) {
    const emg = this.state.activeEmergencies.find(e => e.id === id || e.vehicleId === id);
    if (!emg) {
      throw new Error(`Emergency dispatch dengan ID ${id} tidak ditemukan.`);
    }

    if (["COMPLETED", "CANCELLED"].includes(emg.status)) {
      return this.state;
    }

    emg.status = "CANCELLED";
    emg.updatedAt = new Date().toISOString();
    emg.holdTicks = 0;

    const route = ROUTES_DB[emg.routeId] || ROUTES_DB["route-soetomo"];
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

    this.sequence++;
    this.state.seq = this.sequence;
    this.state.timestampMs = Date.now();

    this.recordAuditLog({
      operator: "Operator SITS 112 Surabaya",
      action: "DISPATCH_CANCEL",
      entity: `Emergency ${emg.id}`,
      result: `SUCCESS (Vehicle ${emg.vehicleId} cancelled by operator)`,
      timestamp: new Date().toISOString()
    });

    if (this.io) {
      this.io.emit('system:toast', {
        message: `🛑 DISPATCH DIBATALKAN: Prioritas darurat untuk ${emg.vehicleId} dihentikan.`,
        type: 'warning'
      });
    }

    return this.state;
  }
}

export const backendState = new BackendStateManager();

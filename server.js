import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateForecastSnapshot, runForecastTestSuite } from './src/modules/forecastEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Middleware Header Keamanan HTTP & Content Security Policy (CSP)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://unpkg.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://*.cartocdn.com https://*.arcgisonline.com https://server.arcgisonline.com https://*.tile.openstreetmap.org https://unpkg.com https://*.unpkg.com",
      "connect-src 'self' ws: wss: http: https:",
      "frame-ancestors 'self' *"
    ].join('; ')
  );
  next();
});

// In-Memory Bounded Rate Limiter (Phase 9 Security Hardening)
const rateLimitStore = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 30000);

function rateLimiter(options = {}) {
  const windowMs = options.windowMs || 15000;
  const maxRequests = options.max || 100;
  const keyPrefix = options.keyPrefix || 'global';

  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();

    let record = rateLimitStore.get(key);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
    } else {
      record.count++;
    }

    rateLimitStore.set(key, record);

    if (record.count > maxRequests) {
      return res.status(429).json({
        success: false,
        type: 'rate_limit_exceeded',
        timestamp: now,
        requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        code: 'TOO_MANY_REQUESTS',
        message: 'Batas frekuensi permintaan terlampaui. Silakan tunggu beberapa detik.',
        retryable: true,
        details: { cooldownMs: Math.max(0, record.resetTime - now) }
      });
    }
    next();
  };
}

// Standardized Error Response Contract Helper
function createApiErrorResponse(statusCode, code, message, details = {}, type = "error") {
  return {
    success: false,
    type,
    timestamp: Date.now(),
    requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    code,
    message,
    retryable: statusCode >= 500 || statusCode === 429,
    details
  };
}

// Sanitization & Security Helper for CSV & Text Data
function sanitizeCsvCell(value) {
  if (value === null || value === undefined) return '""';
  let str = String(value);
  // CSV Formula Injection Prevention: Prepend single quote if cell starts with dangerous chars
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  str = str.replace(/"/g, '""');
  return `"${str}"`;
}

function sanitizeString(str, maxLen = 500) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

// Serve static assets and files from the root directory
app.use(express.static(__dirname, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.webmanifest')) {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    }
  }
}));

// Apply global rate limiter
app.use(rateLimiter({ windowMs: 15000, max: 200, keyPrefix: 'api-global' }));

// Body parser middleware for REST APIs
app.use(express.json({ limit: '1mb' }));

// ============================================================================
// ROUTES DATABASE FOR STATEFUL EMERGENCIES
// ============================================================================
const ROUTES_DB = {
  "route-soetomo": [
    { name: "Bundaran Waru", lat: -7.3510, lng: 112.7290 },
    { name: "Jl. Ahmad Yani (DOLOG)", lat: -7.3450, lng: 112.7300 },
    { name: "Simpang Margorejo", lat: -7.3180, lng: 112.7330, isIntersection: true, id: "node-margorejo" },
    { name: "Simpang Jemursari", lat: -7.3100, lng: 112.7335 },
    { name: "Simpang Wonokromo (DTC)", lat: -7.2985, lng: 112.7345, isIntersection: true, id: "node-wonokromo" },
    { name: "Marmoyo / KBD", lat: -7.2920, lng: 112.7370 },
    { name: "Simpang Raya Darmo - Diponegoro", lat: -7.2810, lng: 112.7395, isIntersection: true, id: "node-darmo" },
    { name: "Jl. Urip Sumoharjo", lat: -7.2760, lng: 112.7430 },
    { name: "Jl. Ngagel - Dinoyo", lat: -7.2720, lng: 112.7480 },
    { name: "RSUD Dr. Soetomo (UGD)", lat: -7.2690, lng: 112.7635, isEnd: true }
  ],
  "route-yani-darmo": [
    { name: "Bundaran Waru", lat: -7.3510, lng: 112.7290 },
    { name: "Jl. Ahmad Yani (DOLOG)", lat: -7.3450, lng: 112.7300 },
    { name: "Simpang Margorejo", lat: -7.3180, lng: 112.7330, isIntersection: true, id: "node-margorejo" },
    { name: "Simpang Jemursari", lat: -7.3100, lng: 112.7335 },
    { name: "Simpang Wonokromo (DTC)", lat: -7.2985, lng: 112.7345, isIntersection: true, id: "node-wonokromo" },
    { name: "Marmoyo / KBD", lat: -7.2920, lng: 112.7370 },
    { name: "Simpang Raya Darmo - Diponegoro", lat: -7.2810, lng: 112.7395, isIntersection: true, id: "node-darmo" },
    { name: "Jl. Urip Sumoharjo", lat: -7.2760, lng: 112.7430 },
    { name: "Jl. Ngagel - Dinoyo", lat: -7.2720, lng: 112.7480 },
    { name: "RSUD Dr. Soetomo (UGD)", lat: -7.2690, lng: 112.7635, isEnd: true }
  ],
  "route-merr-soetomo": [
    { name: "MERR Kertajaya", lat: -7.2850, lng: 112.7830 },
    { name: "Simpang MERR Kertajaya", lat: -7.2710, lng: 112.7565, isIntersection: true, id: "node-merr" },
    { name: "Gubeng", lat: -7.2645, lng: 112.7635 },
    { name: "RSUD Dr. Soetomo (UGD)", lat: -7.2690, lng: 112.7635, isEnd: true }
  ]
};

// SINGLE SOURCE OF TRUTH — BACKEND STATE MANAGER
// ============================================================================
class BackendStateManager {
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
        { id: "node-wonokromo", name: "Simpang Wonokromo", state: "green", timer: 35, greenSplit: 35, waitTime: 42, status: "Normal" },
        { id: "node-margorejo", name: "Simpang Margorejo", state: "red", timer: 35, greenSplit: 28, waitTime: 36, status: "Lancar" },
        { id: "node-darmo", name: "Simpang Raya Darmo", state: "green", timer: 28, greenSplit: 42, waitTime: 28, status: "Lancar" },
        { id: "node-tunjungan", name: "Simpang Tunjungan", state: "yellow", timer: 3, greenSplit: 30, waitTime: 48, status: "Padat" },
        { id: "node-merr", name: "Simpang MERR Kertajaya", state: "green", timer: 45, greenSplit: 45, waitTime: 22, status: "Lancar" }
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
        io.emit('incident:update', { id: existingInc.id, payload: existingInc });
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
        io.emit('incident:update', { id: newInc.id, payload: newInc });
      }

      io.emit('system:toast', {
        message: `⚠️ GANGGUAN JARINGAN: Edge Node ${id} sekarang ${newLevel}!`,
        type: 'danger'
      });
    } else if (newLevel === "DEGRADED") {
      if (existingInc) {
        existingInc.severity = "warning";
        existingInc.title = `Anomali Edge Node SITS: ${id} Terdegradasi`;
        existingInc.updatedAt = nowStr;
        existingInc.notes = `Kinerja menurun. Temp: ${dev.temperatureC}°C, FPS: ${dev.fps}, Latency: ${dev.latencyMs}ms.`;
        io.emit('incident:update', { id: existingInc.id, payload: existingInc });
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
        io.emit('incident:update', { id: newInc.id, payload: newInc });
      }

      io.emit('system:toast', {
        message: `⚠️ PENURUNAN KINERJA: Edge Node ${id} terdegradasi!`,
        type: 'warning'
      });
    } else if (newLevel === "HEALTHY") {
      if (existingInc) {
        existingInc.status = "RESOLVED";
        existingInc.updatedAt = nowStr;
        existingInc.resolvedAt = nowStr;
        existingInc.notes += ` [PULIH] Node kembali ke status HEALTHY pada ${nowStr}.`;
        io.emit('incident:update', { id: existingInc.id, payload: existingInc });
        
        io.emit('system:toast', {
          message: `✅ KONEKSI PULIH: Edge Node ${id} kembali normal (HEALTHY).`,
          type: 'success'
        });
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
        // REQUESTED → VERIFIED → DISPATCHED → EN_ROUTE → ARRIVED → COMPLETED/CANCELLED
        if (emg.status === "REQUESTED") {
          emg.status = "VERIFIED";
          emg.updatedAt = new Date().toISOString();
        } else if (emg.status === "VERIFIED") {
          emg.status = "DISPATCHED";
          emg.updatedAt = new Date().toISOString();
        } else if (emg.status === "DISPATCHED") {
          emg.status = "EN_ROUTE";
          emg.updatedAt = new Date().toISOString();
          // Broadcast to all clients that vehicle is now en route
          io.emit('emergency:dispatch-alert', emg);
        } else if (emg.status === "EN_ROUTE") {
          const route = ROUTES_DB[emg.routeId] || ROUTES_DB["route-soetomo"];
          const speedFactor = this.state.isChaosMode ? 0.6 : 1.0;
          emg.speed = Math.round((this.state.isChaosMode ? 42 : 65) + Math.sin(Date.now() / 1000) * 5);

          // Advance progress (take approx 40 seconds to finish)
          emg.progress += 0.025 * speedFactor;

          if (emg.progress >= 1.0) {
            emg.progress = 1.0;
            emg.status = "ARRIVED";
            emg.ETA = "0s";
            emg.currentPosition = [route[route.length - 1].lat, route[route.length - 1].lng];
            emg.updatedAt = new Date().toISOString();
            emg.holdTicks = 0;

            this.auditLogs.unshift({
              operator: "SITS Automation",
              action: "TRANSITION_ARRIVED",
              entity: `Emergency ${emg.id}`,
              result: `SUCCESS (Vehicle ${emg.vehicleId} arrived at destination)`,
              timestamp: new Date().toISOString()
            });

            io.emit('system:toast', {
              message: `✅ DISPATCH BERHASIL: ${emg.vehicleId} (${emg.vehicleType}) telah sampai di RSUD Dr. Soetomo.`,
              type: 'success'
            });

            // Perform final preemption cleanup for this route
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
            // Interpolate position along checkpoints
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

            // Calculate ETA
            const remainingRatio = 1 - emg.progress;
            const etaSec = Math.round(remainingRatio * 165);
            emg.ETA = `${Math.floor(etaSec / 60)}m ${etaSec % 60}s`;

            // Corridor-aware preemption logic
            let nextIntName = "RSUD Dr. Soetomo (UGD)";
            let nextIntId = null;

            route.forEach((pt, idx) => {
              if (!pt.isIntersection) return;

              // Calculate distance to this intersection
              const dist = Math.sqrt(Math.pow(pt.lat - lat, 2) + Math.pow(pt.lng - lng, 2));

              // Check if intersection is upcoming
              if (idx > segIndex && !nextIntId) {
                nextIntId = pt.id;
                nextIntName = `Simpang ${pt.name.replace('Simpang ', '')}`;
              }

              // Preemption activation within 200m
              if (dist <= 0.0019) {
                const node = this.state.intersections.find(n => n.id === pt.id);
                if (node) {
                  // Conflict Safeguard: check if manual override is active
                  if (node.status === "Manual Override" && !node.isPreempted) {
                    io.emit('system:toast', {
                      message: `⚠️ KONFLIK PRIORITAS: Sinyal Darurat mengesampingkan Override Manual di ${node.name}!`,
                      type: 'warning'
                    });
                    this.auditLogs.unshift({
                      operator: "SITS Preemption Guard",
                      action: "CONFLICT_RESOLVED",
                      entity: node.id,
                      result: `EMERGENCY PREEMPTION OVERRODE MANUAL OVERRIDE`,
                      timestamp: new Date().toISOString()
                    });
                  }

                  // Apply preemption
                  node.state = "green";
                  node.timer = "∞";
                  node.status = "Preemption Aktif";
                  node.isPreempted = true;
                  node.preemptionVehicleId = emg.id;
                }
              }

              // Recovery geofence leaving (> 250m and segIndex > intersection index)
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

      // Filter out completed and cancelled emergencies after grace period
      this.state.activeEmergencies = this.state.activeEmergencies.filter(emg => {
        if (emg.status === "COMPLETED" || emg.status === "CANCELLED") {
          return (emg.holdTicks || 0) < 3;
        }
        return true;
      });
    }

    // Advance APILL Light Timers for all intersections
    this.state.intersections.forEach(node => {
      // If preemption is active, do not tick normal timers
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

      if (typeof node.timer === "string") {
        node.timer = node.greenSplit || 35;
      }

      node.timer--;

      if (node.timer <= 0) {
        if (node.state === "green") {
          node.state = "yellow";
          node.timer = this.yellowDuration;
        } else if (node.state === "yellow") {
          node.state = "red";
          node.timer = node.id === "node-wonokromo" ? this.redDurationBase : 25;
        } else {
          node.state = "green";
          node.timer = node.id === "node-wonokromo" ? this.state.greenSplitWonokromo : (node.greenSplit || 30);
        }
      }

      // Update node status based on congestion & state
      if (node.state === "red") {
        node.status = this.state.isChaosMode ? "Macet Total" : "Padat";
      } else if (node.state === "yellow") {
        node.status = "Transisi";
      } else {
        node.status = this.state.isChaosMode ? "Merayap" : "Lancar";
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
          io.emit('system:toast', { message: 'Sistem ATCS Surabaya pulih otomatis dari Mode Keos.', type: 'info' });
          io.emit('traffic:update', this.state);
        } else {
          this.sequence++;
          this.lastUpdated = Date.now();
          this.state.seq = this.sequence;
          this.state.timestampMs = this.lastUpdated;
          this.state.chaosLevel--;
          io.emit('traffic:update', this.state);
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
    if (intersectionId === "node-wonokromo") {
      this.state.greenSplitWonokromo = val;
    }
    const node = this.state.intersections.find(n => n.id === intersectionId);
    if (node) {
      node.greenSplit = val;
      if (node.state === "green" && typeof node.timer === "number") {
        node.timer = val;
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

  applyAiRecommendation(intersectionId = "node-wonokromo") {
    this.sequence++;
    this.lastUpdated = Date.now();
    this.state.seq = this.sequence;
    this.state.timestampMs = this.lastUpdated;
    const node = this.state.intersections.find(n => n.id === intersectionId) || this.state.intersections[0];
    const optimizedSplit = Math.floor(38 + Math.random() * 12); // e.g. 38-50s
    node.greenSplit = optimizedSplit;
    if (node.id === "node-wonokromo") {
      this.state.greenSplitWonokromo = optimizedSplit;
    }
    this.state.aiScore = Math.min(99, this.state.aiScore + 2);
    this.state.avgWaitTime = Math.max(22, this.state.avgWaitTime - 4);
    return { state: this.state, optimizedSplit, nodeName: node.name };
  }

  signalOverride(intersectionId, duration = 45) {
    this.sequence++;
    this.lastUpdated = Date.now();
    this.state.seq = this.sequence;
    this.state.timestampMs = this.lastUpdated;
    const node = this.state.intersections.find(n => n.id === intersectionId) || this.state.intersections[0];
    node.state = "green";
    node.timer = parseInt(duration, 10) || 45;
    node.status = "Manual Override";
    return { state: this.state, nodeName: node.name, duration };
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
      // Idempotency
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

    // Log to Audit Trail
    const logEntry = {
      operator: "Operator SITS 112 Surabaya",
      action: `TRANSITION_${newStatus}`,
      entity: `Incident ${id}`,
      result: `SUCCESS (dari ${oldStatus} ke ${newStatus})`,
      timestamp: new Date().toISOString()
    };
    this.auditLogs.unshift(logEntry);

    // Broadcast update
    io.emit('incident:update', {
      id: id,
      seq: this.sequence,
      timestamp: Date.now(),
      source: 'server',
      payload: inc
    });

    io.emit('system:toast', {
      message: `🔔 Status Insiden #${id} diubah ke ${newStatus}.`,
      type: 'info'
    });

    return inc;
  }

  activateEmergencyPriority(code, routeId = "route-soetomo") {
    // Check if there is already an active/non-finished dispatch with the same vehicle code
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
      status: "REQUESTED", // Starts as REQUESTED, will auto transition VERIFIED -> DISPATCHED -> EN_ROUTE
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

    // Audit Log Entry
    this.auditLogs.unshift({
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

    // Perform preemption cleanup along the route
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

    this.auditLogs.unshift({
      operator: "Operator SITS 112 Surabaya",
      action: "DISPATCH_CANCEL",
      entity: `Emergency ${emg.id}`,
      result: `SUCCESS (Vehicle ${emg.vehicleId} cancelled by operator)`,
      timestamp: new Date().toISOString()
    });

    io.emit('system:toast', {
      message: `🛑 DISPATCH DIBATALKAN: Prioritas darurat untuk ${emg.vehicleId} dihentikan.`,
      type: 'warning'
    });

    return this.state;
  }
}

// ============================================================================
// COMPUTER VISION MOCK ENGINE — SERVER SIDE OBJECT DETECTION STREAMING
// ============================================================================
class ComputerVisionEngine {
  constructor() {
    this.frameSequence = 1;
    this.cameras = ['dashCameraCanvas', 'cctvCanvas1', 'cctvCanvas2', 'cctvCanvas3', 'cctvCanvas4'];
    this.classes = ['car', 'bus', 'truck', 'motorcycle', 'ambulance', 'person'];
    this.vehiclesPerCam = new Map();

    this.cameras.forEach(camId => {
      this.vehiclesPerCam.set(camId, this._generateInitialVehicles(camId));
    });
  }

  _generateInitialVehicles(camId) {
    const count = camId === 'dashCameraCanvas' ? 6 : 4;
    const vehicles = [];
    for (let i = 0; i < count; i++) {
      const cls = i === 0 ? (camId === 'dashCameraCanvas' ? 'ambulance' : 'bus') :
                  i % 3 === 0 ? 'truck' :
                  i % 2 === 0 ? 'motorcycle' : 'car';
      
      const lane = i % 4;
      vehicles.push({
        id: `${camId}-v${i}`,
        lane: lane,
        progress: (i / count) + Math.random() * 0.1,
        speed: 0.008 + Math.random() * 0.006,
        class: cls,
        confidence: Math.floor(91 + Math.random() * 8)
      });
    }
    return vehicles;
  }

  // Mutate simulated state separately to decouple generation from retrieval
  tickSimulation(isChaosMode) {
    this.cameras.forEach(camId => {
      const vehicles = this.vehiclesPerCam.get(camId) || [];
      vehicles.forEach(v => {
        const effSpeed = isChaosMode ? v.speed * 0.2 : v.speed;
        v.progress += effSpeed;
        if (v.progress > 1.0) {
          v.progress = 0;
          v.lane = Math.floor(Math.random() * 4);
          v.confidence = Math.floor(90 + Math.random() * 9);
        }
      });
    });
  }

  generateFramePayload(isChaosMode) {
    this.frameSequence++;
    const timestamp = Date.now();
    const camerasData = {};

    // First, step the simulation
    this.tickSimulation(isChaosMode);

    this.cameras.forEach(camId => {
      const vehicles = this.vehiclesPerCam.get(camId) || [];
      const detections = [];

      vehicles.forEach(v => {
        // Perspective Projection calculation (0..1 normalized space)
        const t = v.progress;
        const vx = 0.5; // Vanishing point X
        const vy = 0.28; // Vanishing point Y
        const laneEndpointsX = [0.12, 0.36, 0.64, 0.88];
        const bx = laneEndpointsX[v.lane];
        const by = 1.0;

        const xNorm = vx + (bx - vx) * t;
        const yNorm = vy + (by - vy) * t;

        const scale = 0.15 + t * 0.85;

        let baseW = 0.12, baseH = 0.09;
        if (v.class === 'bus') { baseW = 0.16; baseH = 0.12; }
        else if (v.class === 'truck') { baseW = 0.15; baseH = 0.11; }
        else if (v.class === 'ambulance') { baseW = 0.14; baseH = 0.10; }
        else if (v.class === 'motorcycle') { baseW = 0.07; baseH = 0.07; }
        else if (v.class === 'person') { baseW = 0.04; baseH = 0.08; }

        const wNorm = baseW * scale;
        const hNorm = baseH * scale;

        detections.push({
          id: v.id, // For backward compatibility
          trackId: v.id, // Stable identity tracking
          class: v.class,
          confidence: v.confidence,
          x: Math.max(0.01, Math.min(0.95, xNorm - wNorm / 2)),
          y: Math.max(0.01, Math.min(0.95, yNorm - hNorm / 2)),
          w: wNorm,
          h: hNorm,
          speedKmh: Math.round((isChaosMode ? 8 : 42) + Math.random() * 6 - 3)
        });
      });

      camerasData[camId] = {
        cameraId: camId,
        timestamp: timestamp,
        sequence: this.frameSequence,
        fps: isChaosMode ? Math.floor(15 + Math.random() * 4) : Math.floor(29 + Math.random() * 2),
        resolution: '1920x1080',
        source: 'SITS Edge Vision YOLOv8',
        processingLatencyMs: isChaosMode ? Math.floor(22 + Math.random() * 15) : Math.floor(4 + Math.random() * 6),
        streamStatus: isChaosMode ? 'DEGRADED' : 'ONLINE',
        detections: detections
      };
    });

    // Provide structured data payload
    return {
      seq: this.frameSequence,
      timestamp: timestamp,
      source: 'server',
      cameras: camerasData,
      // Retain root key mappings for backwards-compatible client support
      ...Object.fromEntries(Object.entries(camerasData).map(([cid, cam]) => [cid, cam.detections]))
    };
  }
}

// ============================================================================
// PDF REPORT GENERATOR ENGINE (PDF 1.4 FORMATTED BUFFER)
// ============================================================================
function generateSitsPdfBuffer(state) {
  const time = state.timestamp || new Date().toLocaleTimeString('id-ID') + ' WIB';
  const dateStr = new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const lines = [
    "OMNITRAF SURABAYA - SISTEM MANAJEMEN LALU LINTAS CERDAS (SITS)",
    "PEMERINTAH KOTA SURABAYA - DINAS PERHUBUNGAN",
    "LAPORAN RESMI RINGKASAN MOBILITAS & ANALITIK SISTEM",
    "================================================================================",
    `Tanggal Dokumen      : ${dateStr}`,
    `Waktu Kompilasi Data : ${time}`,
    `Status Operasional   : ${state.isChaosMode ? 'STATUS DARURAT (MODE KEOS AKTIF)' : 'OPTIMAL / NORMAL (HIJAU)'}`,
    `Beban Jaringan SITS  : ${state.networkLoad}%`,
    `Indeks Kemacetan Kota: ${state.congestionIndex} / 100`,
    `Rata-Rata Waktu Tunggu: ${state.avgWaitTime} detik`,
    `Volume Kendaraan Hari Ini : ${Number(state.vehiclesToday || 128540).toLocaleString('id-ID')} unit`,
    `Reduksi Emisi Karbon CO2 : ${Number(state.co2SavedKg || 1420).toLocaleString('id-ID')} kg`,
    `Estimasi Penghematan BBM : ${Number(state.fuelSavedLiters || 580).toLocaleString('id-ID')} Liter`,
    `Persentase Uptime SITS   : ${state.sitsUptime || 99.4}%`,
    `Node Kamera CCTV Aktif   : ${state.cctvOnline || 184} / 184 Unit`,
    `Sensor IoT Edge Aktif    : ${state.iotOnline || 312} / 312 Node`,
    "--------------------------------------------------------------------------------",
    "STATUS MONITORING PERSIMPANGAN UTAMA (APILL):",
    ...(state.intersections || []).map(n => 
      `  * ${n.name.padEnd(26)} | Fase: ${n.state.toUpperCase().padEnd(6)} | Sisa: ${String(n.timer).padEnd(4)}s | Split: ${n.greenSplit || 35}s | ${n.status}`
    ),
    "--------------------------------------------------------------------------------",
    "CATATAN KECERDASAN BUATAN & REKOMENDASI ADAPTIF:",
    "  1. Algoritma Edge AI Computer Vision mempertahankan akurasi deteksi 96.4%.",
    "  2. Gelombang Hijau Koridor Darmo-Wonokromo siap diaktifkan saat lonjakan komuter.",
    "  3. Sistem Preemption Kendaraan Darurat 112 dalam status siaga terintegrasi.",
    "================================================================================",
    "Diterbitkan secara otomatis oleh SITS Smart City Gateway Kernel Surabaya."
  ];

  let streamText = "BT\n/F1 13 Tf\n40 800 Td\n(" + lines[0] + ") Tj\n";
  streamText += "/F1 10 Tf\n0 -16 Td\n(" + lines[1] + ") Tj\n";
  streamText += "/F1 9 Tf\n0 -14 Td\n(" + lines[2] + ") Tj\n";
  streamText += "/F2 8 Tf\n";
  for (let i = 3; i < lines.length; i++) {
    const escaped = lines[i].replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    streamText += `0 -12 Td\n(${escaped}) Tj\n`;
  }
  streamText += "ET\n";

  const streamLen = Buffer.byteLength(streamText, 'utf-8');

  const pdfBody = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /MediaBox [0 0 595.28 841.89] /Contents 6 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>
endobj
6 0 obj
<< /Length ${streamLen} >>
stream
${streamText}endstream
endobj
xref
0 7
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000325 00000 n 
0000000402 00000 n 
trailer
<< /Size 7 /Root 1 0 R >>
startxref
${470 + streamLen}
%%EOF`;

  return Buffer.from(pdfBody, 'utf-8');
}

// Instantiate Backend Engines
const backendState = new BackendStateManager();
const cvEngine = new ComputerVisionEngine();

// ============================================================================
// REAL-TIME SOCKET.IO EVENT ROUTING & BROADCAST LOOPS
// ============================================================================

// 1. Core Telemetry & APILL Ticker Loop (1000ms)
setInterval(() => {
  if (io.engine.clientsCount === 0) return; // Skip work if no active socket clients
  const updatedState = backendState.tick();
  io.emit('traffic:update', updatedState);
}, 1000);

// 2. High-Efficiency Computer Vision Detection Bounding Box Stream (300ms)
setInterval(() => {
  if (io.engine.clientsCount === 0) return; // Skip work if no active socket clients
  const isChaos = backendState.state.isChaosMode;
  const visionPayload = cvEngine.generateFramePayload(isChaos);
  io.emit('cctv:vision-update', visionPayload);
}, 300);

// Socket.io Connection & Event Listeners
io.on('connection', (socket) => {
  console.log(`🔌 [Socket.io] Client terhubung: ${socket.id}`);

  // Send initial full canonical state snapshot immediately upon connection
  socket.emit('traffic:init', {
    ...backendState.state,
    seq: backendState.sequence,
    timestampMs: backendState.lastUpdated,
    source: 'server'
  });
  socket.emit('cctv:vision-update', cvEngine.generateFramePayload(backendState.state.isChaosMode));

  // 0. Idempotent State Resynchronization Request
  socket.on('state:resync', (data, callback) => {
    const snapshot = backendState.getSnapshot();
    socket.emit('traffic:init', {
      ...backendState.state,
      seq: backendState.sequence,
      timestampMs: backendState.lastUpdated,
      source: 'server'
    });
    if (typeof callback === 'function') {
      callback({
        success: true,
        ...snapshot
      });
    }
  });

  // 0.1 Heartbeat / Health Ping-Pong
  socket.on('heartbeat:ping', (data, callback) => {
    const res = {
      pong: true,
      clientTimestamp: data?.timestamp || null,
      serverTimestamp: Date.now(),
      seq: backendState.sequence
    };
    socket.emit('heartbeat:pong', res);
    if (typeof callback === 'function') {
      callback(res);
    }
  });

  // Centralized Operator Command Gateway
  socket.on('operator:command', (data, callback) => {
    const { cmd, correlationId } = data || {};
    if (!cmd || !cmd.action) {
      if (typeof callback === 'function') callback({ success: false, error: 'Malformed command structure' });
      return;
    }

    const { action, targetId, payload, source } = cmd;
    let resultingState = null;

    console.info(`🛡️ [Operator Command] Received: ${action} for ${targetId || 'global'} [CorrID: ${correlationId}]`);

    try {
      if (action === 'chaos:toggle') {
        const targetActive = payload ? payload.active : !backendState.state.isChaosMode;
        resultingState = backendState.toggleChaos(targetActive);
        io.emit('traffic:update', resultingState);
        io.emit('system:toast', {
          message: targetActive ? '🔥 MODE KEOS DIAKTIFKAN SERVER: Lonjakan beban jaringan SITS & gridlock!' : 'Sistem ATCS Surabaya pulih dari kondisi darurat.',
          type: targetActive ? 'danger' : 'success'
        });
      }
      else if (action === 'ai:apply-recommendation') {
        const intersectionId = targetId || "node-wonokromo";
        const res = backendState.applyAiRecommendation(intersectionId);
        resultingState = res.state;
        io.emit('traffic:update', resultingState);
        backendState.signalSequence++;
        io.emit('signal:update', {
          seq: backendState.signalSequence,
          timestamp: Date.now(),
          source: 'server',
          nodeId: intersectionId,
          signalData: { greenSplit: res.optimizedSplit, status: "AI Optimized" }
        });
        io.emit('system:toast', {
          message: `✨ Rekomendasi AI Diterapkan: Green Split ${res.nodeName} dioptimalkan ke ${res.optimizedSplit}s!`,
          type: 'success'
        });
      }
      else if (action === 'signal:override') {
        const intersectionId = targetId || "node-wonokromo";
        const duration = payload ? payload.duration : 45;
        const res = backendState.signalOverride(intersectionId, duration);
        resultingState = res.state;
        io.emit('traffic:update', resultingState);
        backendState.signalSequence++;
        io.emit('signal:update', {
          seq: backendState.signalSequence,
          timestamp: Date.now(),
          source: 'server',
          nodeId: intersectionId,
          signalData: { state: "green", timer: duration, status: "Manual Override" }
        });
        io.emit('system:toast', {
          message: `🛠️ Manual Override Aktif: Durasi ${res.nodeName} dikunci ${res.duration}s!`,
          type: 'warning'
        });
      }
      else if (action === 'emergency:activate') {
        const code = payload ? payload.code : "AMB-02";
        const route = payload ? payload.route : "route-soetomo";
        const res = backendState.activateEmergencyPriority(code, route);
        resultingState = res.state;
        io.emit('traffic:update', resultingState);
        backendState.emergencySequence++;
        io.emit('emergency:update', {
          seq: backendState.emergencySequence,
          timestamp: Date.now(),
          source: 'server',
          payload: {
            greenWaveActive: true,
            emergencyItem: res.emergencyItem,
            activeEmergencies: res.state.activeEmergencies
          }
        });
        io.emit('system:toast', {
          message: `🚨 Prioritas Darurat Aktif: ${code} di rute ${route.replace('route-', '').toUpperCase()} (Preemption Berpola Aktif).`,
          type: 'alert'
        });
      }
      else if (action === 'emergency:cancel') {
        const id = targetId || payload?.id;
        resultingState = backendState.cancelEmergency(id);
        io.emit('traffic:update', resultingState);
        backendState.emergencySequence++;
        io.emit('emergency:update', {
          seq: backendState.emergencySequence,
          timestamp: Date.now(),
          source: 'server',
          payload: { activeEmergencies: resultingState.activeEmergencies }
        });
      }
      else if (action === 'green-split:update') {
        const value = payload ? payload.value : 35;
        const intersectionId = targetId || "node-wonokromo";
        resultingState = backendState.setGreenSplit(value, intersectionId);
        io.emit('traffic:update', resultingState);
        backendState.signalSequence++;
        io.emit('signal:update', {
          seq: backendState.signalSequence,
          timestamp: Date.now(),
          source: 'server',
          nodeId: intersectionId,
          signalData: { greenSplit: value }
        });
      }
      else if (action === 'green-wave:toggle') {
        const active = payload ? payload.active : false;
        resultingState = backendState.toggleGreenWave(active);
        io.emit('traffic:update', resultingState);
        backendState.emergencySequence++;
        io.emit('emergency:update', {
          seq: backendState.emergencySequence,
          timestamp: Date.now(),
          source: 'server',
          payload: { greenWaveActive: active }
        });
        io.emit('system:toast', {
          message: active ? '🚨 Emergency Green Wave Aktif! Sinyal A. Yani - Darmo dikunci Hijau.' : 'Green Wave Dinonaktifkan. Sinyal SITS kembali ke mode otomatis.',
          type: active ? 'alert' : 'info'
        });
      }
      else if (action === 'incident:acknowledge') {
        const id = targetId;
        const inc = backendState.updateIncidentStatus(id, "ACKNOWLEDGED");
        resultingState = backendState.state;
      }
      else if (action === 'incident:resolve') {
        const id = targetId;
        const inc = backendState.updateIncidentStatus(id, "RESOLVED");
        resultingState = backendState.state;
      }
      else if (action === 'siren:mute') {
        backendState.state.isSirenMuted = payload ? !!payload.muted : false;
        resultingState = backendState.state;
        io.emit('traffic:update', resultingState);
      }
      else if (action === 'cctv:snapshot') {
        backendState.auditLogs.unshift({
          operator: source || "Zaki Putra (Operator)",
          action: "CCTV_SNAPSHOT",
          entity: targetId,
          result: "SUCCESS",
          timestamp: new Date().toISOString()
        });
        resultingState = backendState.state;
      } else {
        throw new Error(`Aksi '${action}' tidak dikenali oleh system core.`);
      }

      // Add to server audit logs
      const serverAuditLog = {
        operator: source || "Zaki Putra (Operator)",
        action: action.toUpperCase().replace('-', '_'),
        entity: targetId || "SITS Core",
        result: `SUCCESS (CorrelationID: ${correlationId})`,
        timestamp: new Date().toISOString()
      };
      backendState.auditLogs.unshift(serverAuditLog);

      // Broadcast audit event to all clients to keep the terminal logs in sync
      const clientAuditLog = {
        type: `command:acknowledged`,
        timestamp: new Date().toISOString(),
        entity: targetId || "System Core",
        source: source || "Zaki Putra (Operator)",
        reasonCode: "EXECUTION_ACK",
        result: "SUCCESS",
        correlationId,
        details: `Perintah [${action}] berhasil dieksekusi.`
      };
      io.emit('audit:log', clientAuditLog);

      if (typeof callback === 'function') {
        callback({ success: true, resultingState });
      }
    } catch (err) {
      console.error(`❌ [Command Error]:`, err);
      const errAuditLog = {
        type: `command:failed`,
        timestamp: new Date().toISOString(),
        entity: targetId || "System Core",
        source: source || "Zaki Putra (Operator)",
        reasonCode: "EXECUTION_FAIL",
        result: "FAILED",
        correlationId,
        details: `Perintah [${action}] gagal: ${err.message}`
      };
      io.emit('audit:log', errAuditLog);

      if (typeof callback === 'function') {
        callback({ success: false, error: err.message });
      }
    }
  });

  // 1. Toggle Chaos Mode
  socket.on('chaos:toggle', (data, callback) => {
    const targetActive = data ? data.active : !backendState.state.isChaosMode;
    const newState = backendState.toggleChaos(targetActive);
    io.emit('traffic:update', newState);
    io.emit('system:toast', {
      message: targetActive ? '🔥 MODE KEOS DIAKTIFKAN SERVER: Lonjakan beban jaringan SITS & gridlock!' : 'Sistem ATCS Surabaya pulih dari kondisi darurat.',
      type: targetActive ? 'danger' : 'success'
    });
    if (typeof callback === 'function') {
      callback({
        success: true,
        isChaosMode: newState.isChaosMode,
        chaosLevel: newState.chaosLevel,
        seq: backendState.sequence
      });
    }
  });

  // 2. Terapkan Rekomendasi AI SITS
  socket.on('ai:apply-recommendation', (data, callback) => {
    const intersectionId = data ? data.intersectionId : "node-wonokromo";
    const res = backendState.applyAiRecommendation(intersectionId);
    
    io.emit('traffic:update', res.state);
    
    backendState.signalSequence++;
    io.emit('signal:update', {
      seq: backendState.signalSequence,
      timestamp: Date.now(),
      source: 'server',
      nodeId: intersectionId,
      signalData: {
        greenSplit: res.optimizedSplit,
        status: "AI Optimized"
      }
    });

    io.emit('system:toast', {
      message: `✨ Rekomendasi AI Diterapkan: Green Split ${res.nodeName} dioptimalkan ke ${res.optimizedSplit}s!`,
      type: 'success'
    });
    if (typeof callback === 'function') {
      callback({
        success: true,
        optimizedSplit: res.optimizedSplit,
        nodeName: res.nodeName,
        seq: backendState.sequence
      });
    }
  });

  // 3. Manual Override Sinyal APILL
  socket.on('signal:override', (data, callback) => {
    const intersectionId = data ? data.intersectionId : "node-wonokromo";
    const duration = data ? data.duration : 45;
    const res = backendState.signalOverride(intersectionId, duration);
    
    io.emit('traffic:update', res.state);
    
    backendState.signalSequence++;
    io.emit('signal:update', {
      seq: backendState.signalSequence,
      timestamp: Date.now(),
      source: 'server',
      nodeId: intersectionId,
      signalData: {
        state: "green",
        timer: duration,
        status: "Manual Override"
      }
    });

    io.emit('system:toast', {
      message: `🛠️ Manual Override Aktif: Durasi ${res.nodeName} dikunci ${res.duration}s!`,
      type: 'warning'
    });
    if (typeof callback === 'function') {
      callback({
        success: true,
        nodeName: res.nodeName,
        duration: res.duration,
        seq: backendState.sequence
      });
    }
  });

  // 4. Aktifkan Sinyal Prioritas (Ambulans/PMK)
  socket.on('emergency:activate', (data, callback) => {
    const code = data ? data.code : "AMB-02";
    const route = data ? data.route : "route-soetomo";
    
    try {
      const res = backendState.activateEmergencyPriority(code, route);
      
      io.emit('traffic:update', res.state);
      
      backendState.emergencySequence++;
      io.emit('emergency:update', {
        seq: backendState.emergencySequence,
        timestamp: Date.now(),
        source: 'server',
        payload: {
          greenWaveActive: true,
          emergencyItem: res.emergencyItem,
          activeEmergencies: res.state.activeEmergencies
        }
      });

      io.emit('system:toast', {
        message: `🚨 Prioritas Darurat Aktif: ${code} di rute ${route.replace('route-', '').toUpperCase()} (Preemption Berpola Aktif).`,
        type: 'alert'
      });
      
      if (typeof callback === 'function') {
        callback({
          success: true,
          emergencyItem: res.emergencyItem,
          seq: backendState.sequence
        });
      }
    } catch (err) {
      console.warn(`[Socket emergency:activate] Error: ${err.message}`);
      if (typeof callback === 'function') {
        callback({
          success: false,
          error: err.message
        });
      }
    }
  });

  // 4.1 Batalkan Prioritas Sinyal Darurat
  socket.on('emergency:cancel', (data, callback) => {
    const id = data ? data.id : null;
    if (!id) {
      if (typeof callback === 'function') callback({ success: false, error: 'Missing emergency ID' });
      return;
    }

    try {
      const newState = backendState.cancelEmergency(id);
      
      io.emit('traffic:update', newState);
      
      backendState.emergencySequence++;
      io.emit('emergency:update', {
        seq: backendState.emergencySequence,
        timestamp: Date.now(),
        source: 'server',
        payload: {
          activeEmergencies: newState.activeEmergencies
        }
      });

      if (typeof callback === 'function') {
        callback({
          success: true,
          seq: backendState.sequence
        });
      }
    } catch (err) {
      console.warn(`[Socket emergency:cancel] Error: ${err.message}`);
      if (typeof callback === 'function') {
        callback({
          success: false,
          error: err.message
        });
      }
    }
  });

  // 5. Update Green Split Slider
  socket.on('green-split:update', (data, callback) => {
    if (!data) {
      if (typeof callback === 'function') callback({ success: false, error: 'No data' });
      return;
    }
    const newState = backendState.setGreenSplit(data.value, data.intersectionId);
    
    io.emit('traffic:update', newState);
    
    backendState.signalSequence++;
    io.emit('signal:update', {
      seq: backendState.signalSequence,
      timestamp: Date.now(),
      source: 'server',
      nodeId: data.intersectionId,
      signalData: {
        greenSplit: data.value
      }
    });

    if (typeof callback === 'function') {
      callback({
        success: true,
        greenSplit: data.value,
        seq: backendState.sequence
      });
    }
  });

  // 6. Toggle Emergency Green Wave
  socket.on('green-wave:toggle', (data, callback) => {
    const active = data ? data.active : false;
    const newState = backendState.toggleGreenWave(active);
    
    io.emit('traffic:update', newState);
    
    backendState.emergencySequence++;
    io.emit('emergency:update', {
      seq: backendState.emergencySequence,
      timestamp: Date.now(),
      source: 'server',
      payload: {
        greenWaveActive: active
      }
    });

    io.emit('system:toast', {
      message: active ? '🚨 Emergency Green Wave Aktif! Sinyal A. Yani - Darmo dikunci Hijau.' : 'Green Wave Dinonaktifkan. Sinyal SITS kembali ke mode otomatis.',
      type: active ? 'alert' : 'info'
    });
    if (typeof callback === 'function') {
      callback({
        success: true,
        greenWaveActive: active,
        seq: backendState.sequence
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ [Socket.io] Client terputus: ${socket.id}`);
  });
});

// ============================================================================
// REST API ENDPOINTS FOR SMART CITY SYSTEM INTEGRATION
// ============================================================================

// 0. Canonical State Snapshot & Resync REST Endpoints (Idempotent)
app.get(['/api/state/snapshot', '/api/state/resync'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({
    success: true,
    status: 'success',
    seq: backendState.sequence,
    timestamp: backendState.lastUpdated,
    source: 'server',
    state: backendState.state
  });
});

// 0.1 Real-time Server-Sent Events (SSE) Stream Endpoint for Traffic Telemetry
app.get('/api/stream-traffic', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Send initial canonical payload immediately with sequence metadata
  const initialPayload = {
    ...backendState.state,
    seq: backendState.sequence,
    timestampMs: backendState.lastUpdated,
    source: 'server'
  };
  res.write(`data: ${JSON.stringify(initialPayload)}\n\n`);

  const sseInterval = setInterval(() => {
    const payload = {
      ...backendState.state,
      seq: backendState.sequence,
      timestampMs: backendState.lastUpdated,
      source: 'server'
    };
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }, 1000);

  req.on('close', () => {
    clearInterval(sseInterval);
  });
});

// 1. PDF Report Download REST API
app.get('/api/reports/download', (req, res) => {
  try {
    const pdfBuffer = generateSitsPdfBuffer(backendState.state);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `OmniTRAF-SITS-Surabaya-Mobility-Report-${dateStamp}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error('❌ [API Report] Gagal men-generate PDF buffer:', err);
    res.status(500).json({
      status: "error",
      message: "Gagal menghasilkan dokumen laporan PDF mobilitas SITS.",
      error: err.message
    });
  }
});

// 2. Dynamic AI Prediction Endpoint (Deterministic Weighted Diurnal Model & Phase 5 Decision Support)
app.get('/api/prediction/v1/forecast', (req, res) => {
  try {
    const hour = parseFloat(req.query.hour ?? new Date().getHours());
    const clampedHour = Math.max(0, Math.min(23, isNaN(hour) ? 17 : hour));

    // Combine current backend live state with request query parameters
    const currentState = backendState.getSnapshot().state || {};
    const forecastSnapshot = generateForecastSnapshot(clampedHour, currentState);

    res.json({
      success: true,
      ...forecastSnapshot
    });
  } catch (err) {
    console.error('❌ [API Forecast] Error:', err);
    res.status(500).json({ status: "error", success: false, message: err.message });
  }
});

// 2.1 Automated Forecast Engine Test Suite Endpoint
app.get('/api/prediction/v1/test-cases', (req, res) => {
  try {
    const currentState = backendState.getSnapshot().state || {};
    const testReport = runForecastTestSuite(currentState);
    res.json({
      success: true,
      status: "success",
      testReport
    });
  } catch (err) {
    console.error('❌ [API Forecast Test Suite] Error:', err);
    res.status(500).json({ status: "error", success: false, message: err.message });
  }
});

// 3. Device Management & Edge Node Configuration REST APIs
app.post('/api/devices/config', async (req, res) => {
  const { deviceId, fps, resolution, mode, greenWaveSync, refreshRate, actor } = req.body || {};
  const currentTimestamp = Date.now();
  const act = actor || "Zaki Putra (Operator)";

  // 1. Validasi keberadaan deviceId
  if (!deviceId) {
    return res.status(400).json({
      success: false,
      type: "validation_error",
      timestamp: currentTimestamp,
      version: backendState.sequence,
      data: null,
      error: { code: "validation_error", message: "Parameter deviceId wajib disertakan." }
    });
  }

  const dev = backendState.devicesRegistry.find(d => d.deviceId === deviceId);
  if (!dev) {
    return res.status(404).json({
      success: false,
      type: "not_found",
      timestamp: currentTimestamp,
      version: backendState.sequence,
      data: null,
      error: { code: "not_found", message: `Perangkat dengan ID ${deviceId} tidak ditemukan di registry.` }
    });
  }

  // 2. Validasi parameter konfigurasi
  if (fps !== undefined) {
    const fpsVal = parseInt(fps, 10);
    if (isNaN(fpsVal) || fpsVal < 5 || fpsVal > 60) {
      return res.status(400).json({
        success: false,
        type: "validation_error",
        timestamp: currentTimestamp,
        version: backendState.sequence,
        data: null,
        error: { code: "validation_error", message: "Frame Rate Limit (FPS) harus berupa angka antara 5 dan 60." }
      });
    }
  }

  if (resolution !== undefined) {
    const validRes = ['720p', '1080p', '4k'];
    if (!validRes.includes(resolution)) {
      return res.status(400).json({
        success: false,
        type: "validation_error",
        timestamp: currentTimestamp,
        version: backendState.sequence,
        data: null,
        error: { code: "validation_error", message: "Resolusi kamera tidak valid. Harus salah satu dari: 720p, 1080p, 4k." }
      });
    }
  }

  if (greenWaveSync !== undefined && typeof greenWaveSync !== 'boolean') {
    return res.status(400).json({
      success: false,
      type: "validation_error",
      timestamp: currentTimestamp,
      version: backendState.sequence,
      data: null,
      error: { code: "validation_error", message: "greenWaveSync harus berupa boolean." }
    });
  }

  // Pola transisi: REQUESTED → VALIDATING → APPLIED
  const actionId = `ACT-CFG-${Date.now()}`;
  const previousState = {
    fps: dev.fps,
    resolution: dev.resolution,
    mode: dev.mode || 'Adaptive AI (YOLOv8)',
    greenWaveSync: dev.greenWaveSync ?? true
  };

  const newState = {
    fps: fps !== undefined ? parseInt(fps, 10) : dev.fps,
    resolution: resolution !== undefined ? resolution : dev.resolution,
    mode: mode !== undefined ? mode : (dev.mode || 'Adaptive AI (YOLOv8)'),
    greenWaveSync: greenWaveSync !== undefined ? !!greenWaveSync : (dev.greenWaveSync ?? true)
  };

  // Emit event transisi pertama: REQUESTED
  backendState.deviceSequence++;
  io.emit('device:config-transition', {
    actionId,
    deviceId,
    status: 'REQUESTED',
    timestamp: Date.now(),
    actor: act,
    previousState,
    newState
  });

  // Emit event transisi kedua: VALIDATING (simulasi validasi hardware)
  io.emit('device:config-transition', {
    actionId,
    deviceId,
    status: 'VALIDATING',
    timestamp: Date.now(),
    actor: act,
    previousState,
    newState
  });

  // Terapkan konfigurasi baru secara aktual ke database / registry
  if (fps !== undefined) dev.fps = parseInt(fps, 10);
  if (resolution !== undefined) dev.resolution = resolution;
  if (mode !== undefined) dev.mode = mode;
  if (greenWaveSync !== undefined) dev.greenWaveSync = !!greenWaveSync;
  dev.updatedAt = new Date().toISOString();

  // Simpan record audit action
  const auditRecord = {
    actionId,
    deviceId,
    requestedAt: new Date(currentTimestamp).toISOString(),
    completedAt: new Date().toISOString(),
    actor: act,
    previousState,
    newState,
    result: "SUCCESS",
    errorCode: null,
    status: "APPLIED"
  };

  if (!backendState.deviceAuditTrail) {
    backendState.deviceAuditTrail = [];
  }
  backendState.deviceAuditTrail.unshift(auditRecord);

  // Emit event transisi ketiga: APPLIED
  io.emit('device:config-transition', {
    actionId,
    deviceId,
    status: 'APPLIED',
    timestamp: Date.now(),
    actor: act,
    previousState,
    newState
  });

  // Emit device update utama agar seluruh client ter-sinkronisasi
  io.emit('device:update', {
    seq: backendState.deviceSequence,
    timestamp: Date.now(),
    source: 'server',
    deviceId,
    deviceData: dev
  });

  res.status(200).json({
    success: true,
    type: "device_config_updated",
    timestamp: Date.now(),
    version: backendState.sequence,
    data: {
      actionId,
      deviceId,
      status: "APPLIED",
      previousState,
      newState,
      completedAt: auditRecord.completedAt
    },
    error: null
  });
});

const handleDevicePing = (req, res) => {
  const currentTimestamp = Date.now();
  const deviceId = req.query.deviceId || req.body?.deviceId;
  const actor = req.query.actor || req.body?.actor || "Zaki Putra (Operator)";

  if (!deviceId) {
    return res.status(400).json({
      success: false,
      type: "validation_error",
      timestamp: currentTimestamp,
      version: backendState.sequence,
      data: null,
      error: { code: "validation_error", message: "Parameter deviceId wajib disertakan." }
    });
  }

  const dev = backendState.devicesRegistry.find(d => d.deviceId === deviceId);
  if (!dev) {
    return res.status(404).json({
      success: false,
      type: "not_found",
      timestamp: currentTimestamp,
      version: backendState.sequence,
      data: null,
      error: { code: "not_found", message: `Perangkat dengan ID ${deviceId} tidak ditemukan di registry.` }
    });
  }

  // Ping update telemetry
  const latency = Math.floor(Math.random() * 5) + 6; // 6-10 ms
  dev.latencyMs = latency;
  dev.packetLossPercent = 0;
  dev.lastSeenAt = new Date().toISOString();
  dev.lastHeartbeatAt = new Date().toISOString();
  dev.consecutiveFailures = 0;
  dev.updatedAt = new Date().toISOString();

  // Hitung ulang health score
  backendState.tickDevices();

  // Tambah audit trail
  const actionId = `ACT-PING-${Date.now()}`;
  const auditRecord = {
    actionId,
    deviceId,
    requestedAt: new Date(currentTimestamp).toISOString(),
    completedAt: new Date().toISOString(),
    actor,
    previousState: { latencyMs: dev.latencyMs },
    newState: { latencyMs: latency, status: dev.status },
    result: "SUCCESS",
    errorCode: null
  };

  if (!backendState.deviceAuditTrail) {
    backendState.deviceAuditTrail = [];
  }
  backendState.deviceAuditTrail.unshift(auditRecord);

  // Emit update ke clients
  backendState.deviceSequence++;
  io.emit('device:update', {
    seq: backendState.deviceSequence,
    timestamp: Date.now(),
    source: 'server',
    deviceId,
    deviceData: dev
  });

  res.status(200).json({
    success: true,
    type: "device_ping_success",
    timestamp: Date.now(),
    version: backendState.sequence,
    data: {
      deviceId,
      latencyMs: latency,
      packetLossPercent: 0,
      status: dev.status,
      healthScore: dev.healthScore,
      actionId
    },
    error: null
  });
};

app.get('/api/devices/ping', handleDevicePing);
app.post('/api/devices/ping', handleDevicePing);

// Endpoint untuk deterministic fault injection dan audit trail
app.post('/api/devices/fault', (req, res) => {
  const { deviceId, type, duration, actor } = req.body || {};
  const currentTimestamp = Date.now();
  const act = actor || "Zaki Putra (Operator)";

  if (!deviceId) {
    return res.status(400).json({
      success: false,
      type: "validation_error",
      timestamp: currentTimestamp,
      version: backendState.sequence,
      data: null,
      error: { code: "validation_error", message: "Parameter deviceId wajib disertakan." }
    });
  }

  const dev = backendState.devicesRegistry.find(d => d.deviceId === deviceId);
  if (!dev) {
    return res.status(404).json({
      success: false,
      type: "not_found",
      timestamp: currentTimestamp,
      version: backendState.sequence,
      data: null,
      error: { code: "not_found", message: `Perangkat dengan ID ${deviceId} tidak ditemukan.` }
    });
  }

  const previousState = {
    latencyMs: dev.latencyMs,
    packetLossPercent: dev.packetLossPercent,
    fps: dev.fps,
    temperatureC: dev.temperatureC,
    healthLevel: dev.healthLevel,
    status: dev.status
  };

  if (type === "recover" || type === "clear") {
    delete backendState.activeFaults[deviceId];
    dev.consecutiveFailures = 0;
    dev.errorCount = 0;
  } else {
    const validFaults = ["latency_spike", "packet_loss", "low_fps", "thermal_warning", "heartbeat_timeout"];
    if (!validFaults.includes(type)) {
      return res.status(400).json({
        success: false,
        type: "validation_error",
        timestamp: currentTimestamp,
        version: backendState.sequence,
        data: null,
        error: { code: "validation_error", message: `Tipe gangguan tidak valid. Harus salah satu dari: ${validFaults.join(", ")}` }
      });
    }

    backendState.activeFaults[deviceId] = {
      type,
      duration: duration || 30000,
      timestamp: currentTimestamp
    };
  }

  // Jalankan tickDevices agar status langsung terhitung ulang
  backendState.tickDevices();

  const actionId = `ACT-FAULT-${Date.now()}`;
  const auditRecord = {
    actionId,
    deviceId,
    requestedAt: new Date(currentTimestamp).toISOString(),
    completedAt: new Date().toISOString(),
    actor: act,
    previousState,
    newState: {
      latencyMs: dev.latencyMs,
      packetLossPercent: dev.packetLossPercent,
      fps: dev.fps,
      temperatureC: dev.temperatureC,
      healthLevel: dev.healthLevel,
      status: dev.status
    },
    result: "SUCCESS",
    errorCode: null
  };

  if (!backendState.deviceAuditTrail) {
    backendState.deviceAuditTrail = [];
  }
  backendState.deviceAuditTrail.unshift(auditRecord);

  // Emit update ke clients
  backendState.deviceSequence++;
  io.emit('device:update', {
    seq: backendState.deviceSequence,
    timestamp: Date.now(),
    source: 'server',
    deviceId,
    deviceData: dev
  });

  res.status(200).json({
    success: true,
    type: "device_fault_injected",
    timestamp: Date.now(),
    version: backendState.sequence,
    data: {
      actionId,
      deviceId,
      faultType: type,
      deviceData: dev
    },
    error: null
  });
});

app.get('/api/devices/audit', (req, res) => {
  const deviceId = req.query.deviceId;
  let trail = backendState.deviceAuditTrail || [];
  if (deviceId) {
    trail = trail.filter(t => t.deviceId === deviceId);
  }
  res.json({
    success: true,
    type: "device_audit_trail",
    timestamp: Date.now(),
    version: backendState.sequence,
    data: trail,
    error: null
  });
});

// 4. Incident Management REST API
app.get('/api/incidents', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({
    status: "success",
    success: true,
    timestamp: Date.now(),
    version: backendState.sequence,
    incidents: backendState.state.incidents
  });
});

app.get('/api/emergencies', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({
    success: true,
    status: "success",
    timestamp: Date.now(),
    version: backendState.sequence,
    emergencies: backendState.state.activeEmergencies
  });
});

app.get('/api/audit-logs', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({
    success: true,
    status: "success",
    timestamp: Date.now(),
    logs: backendState.auditLogs
  });
});

app.patch('/api/incidents/:id/status', (req, res) => {
  const incidentId = req.params.id;
  const { status, assignedUnit, notes } = req.body;

  if (!status) {
    return res.status(400).json({
      success: false,
      type: "validation_error",
      timestamp: Date.now(),
      error: "Status parameter is required."
    });
  }

  try {
    const updated = backendState.updateIncidentStatus(incidentId, status, assignedUnit, notes);
    res.status(200).json({
      success: true,
      type: "incident_status_updated",
      timestamp: Date.now(),
      version: backendState.sequence,
      data: updated
    });
  } catch (err) {
    console.error('❌ [API Incident Status] Error:', err);
    res.status(err.message.includes("tidak ditemukan") ? 404 : 400).json({
      success: false,
      type: "error",
      timestamp: Date.now(),
      error: err.message
    });
  }
});

const handleIncidentResolution = (req, res) => {
  const incidentId = req.params.id;
  
  try {
    const updated = backendState.updateIncidentStatus(incidentId, "RESOLVED");
    res.status(200).json({
      success: true,
      statusCode: 200,
      id: incidentId,
      status: "RESOLVED",
      message: `Insiden #${incidentId} telah berhasil ditandai Selesai di Backend SITS.`,
      timestamp: backendState._getWibTimeString(),
      resolvedBy: "Operator SITS 112 Surabaya",
      data: updated
    });
  } catch (err) {
    console.error('❌ [API Incident Resolve] Error:', err);
    res.status(err.message.includes("tidak ditemukan") ? 404 : 400).json({
      success: false,
      type: "error",
      timestamp: Date.now(),
      error: err.message
    });
  }
};

app.patch('/api/incidents/:id/resolve', handleIncidentResolution);
app.put('/api/incidents/:id/resolve', handleIncidentResolution);
app.post('/api/incidents/:id/resolve', handleIncidentResolution);

// 5. API Sandbox REST Endpoints
app.get('/v1/traffic/realtime', (req, res) => res.json({
  status: "success",
  timestamp: new Date().toISOString(),
  city: "Surabaya",
  activeNodes: 184,
  networkLoadPercent: backendState.state.networkLoad,
  averageWaitTimeSec: backendState.state.avgWaitTime,
  activeCorridor: "Jl. Ahmad Yani (Frontage Margorejo)"
}));

app.get('/v1/signals/cycle', (req, res) => res.json({
  status: "success",
  junctionId: "SITS-WNK-01",
  phase: backendState.state.greenWaveActive ? "GREEN_WAVE_LOCKED" : "ADAPTIVE_GREEN",
  cycleRemainingSec: backendState.state.intersections[0].timer,
  splitOptimizationRatio: 1.45
}));

app.get('/v1/cctv/detections', (req, res) => res.json({
  status: "success",
  camera: "CCTV-01-AYANI",
  fps: 30.0,
  detectionsCount: 18,
  breakdown: { cars: 10, motorcycles: 6, buses: 2 }
}));

// Proxy or generic API router for sandbox requests
app.all('/api/v1/*', (req, res) => {
  const pathStr = req.path.replace('/api', '');
  if (pathStr === '/v1/traffic/realtime') {
    return res.json({
      status: "success",
      timestamp: new Date().toISOString(),
      city: "Surabaya",
      activeNodes: 184,
      networkLoadPercent: backendState.state.networkLoad,
      averageWaitTimeSec: backendState.state.avgWaitTime,
      activeCorridor: "Jl. Ahmad Yani (Frontage Margorejo)"
    });
  }
  if (pathStr === '/v1/signals/cycle') {
    return res.json({
      status: "success",
      junctionId: "SITS-WNK-01",
      phase: backendState.state.greenWaveActive ? "GREEN_WAVE_LOCKED" : "ADAPTIVE_GREEN",
      cycleRemainingSec: backendState.state.intersections[0].timer,
      splitOptimizationRatio: 1.45
    });
  }
  if (pathStr === '/v1/cctv/detections') {
    return res.json({
      status: "success",
      camera: "CCTV-01-AYANI",
      fps: 30.0,
      detectionsCount: 18,
      breakdown: { cars: 10, motorcycles: 6, buses: 2 }
    });
  }
  return res.json({
    status: "success",
    method: req.method,
    endpoint: req.path,
    timestamp: new Date().toISOString(),
    message: `Respons sukses dari Server API SITS Surabaya untuk ${req.method} ${req.path}`,
    data: req.body || null
  });
});

// 6. Sandbox Terminal Execution Endpoint
app.post('/api/terminal/execute', (req, res) => {
  const { command, actor } = req.body || {};
  const cmd = (command || '').trim();
  const lower = cmd.toLowerCase().split(' ')[0]; // Ambil perintah pertamanya saja
  const time = backendState._getWibTimeString();
  const executionId = `EXEC-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
  const act = actor || "Zaki Putra (Operator)";

  let responseLines = [];
  let color = "var(--text)";

  if (!cmd) {
    return res.json({ success: false, error: "Empty command" });
  }

  // Daftar perintah yang diizinkan murni (Whitelisted Only)
  const allowedCommands = ['/help', 'help', '/status', 'status', '/ping', 'ping', '/telemetry', 'telemetry', '/nodes', 'nodes', '/chaos', 'chaos', '/clear', 'clear', '/perf', 'perf', '/sys-metrics'];

  if (!allowedCommands.includes(lower)) {
    responseLines = [
      `❌ PERINTAH DITOLAK: Perintah '${cmd}' tidak aman atau tidak diizinkan.`,
      `Gunakan /help untuk melihat panduan perintah yang valid.`
    ];

    // Catat kegagalan ke audit trail
    const auditRecord = {
      operator: act,
      action: "TERMINAL_EXEC_REJECT",
      entity: `Terminal ${executionId}`,
      result: `REJECTED (Command '${cmd}' is not allowed)`,
      timestamp: new Date().toISOString()
    };
    backendState.auditLogs.unshift(auditRecord);
    if (backendState.auditLogs.length > 150) backendState.auditLogs.pop();

    return res.json({
      success: false,
      executionId,
      command: cmd,
      timestamp: time,
      output: responseLines,
      color: "var(--danger)"
    });
  }

  if (lower === '/help' || lower === 'help') {
    responseLines = [
      "Perintah SITS Gateway yang tersedia:",
      "  • /status     - Cek kesehatan gateway & node SITS",
      "  • /telemetry  - Ringkasan statistik & jaringan real-time",
      "  • /nodes      - Daftar kluster sensor persimpangan",
      "  • /ping       - Tes latensi ke edge node",
      "  • /chaos      - Status mode keos SITS",
      "  • /perf       - Diagnostics performa & statistik memori server",
      "  • /clear      - Bersihkan log tampilan terminal"
    ];
    color = "var(--primary-2)";
  } else if (lower === '/perf' || lower === 'perf' || lower === '/sys-metrics') {
    const mem = process.memoryUsage();
    responseLines = [
      `📊 DIAGNOSTIK PERFORMA SERVER SITS:`,
      `  • Heap Used  : ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      `  • Heap Total : ${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      `  • RSS        : ${(mem.rss / 1024 / 1024).toFixed(2)} MB`,
      `  • Connected Clients: ${io.engine.clientsCount}`,
      `  • Active Sequence : ${backendState.sequence}`
    ];
    color = "var(--cyan)";
  } else if (lower === '/status' || lower === 'status') {
    responseLines = [
      `[HTTP 200 OK] SITS Enterprise Server: ONLINE`,
      `Backend Uptime: ${backendState.state.sitsUptime}% | CCTV Online: ${backendState.state.cctvOnline}/184`,
      `IoT Sensors: ${backendState.state.iotOnline}/312 | AI Confidence: ${backendState.state.aiConfidence}%`
    ];
    color = "var(--success)";
  } else if (lower === '/ping' || lower === 'ping') {
    responseLines = [
      `Memulai ping ke 4 Edge Node SITS Surabaya...`,
      `  • Node Wonokromo (DTC)     : 8 ms  [ONLINE]`,
      `  • Node Raya Darmo          : 11 ms [ONLINE]`,
      `  • Node Tunjungan / Siola   : 14 ms [ONLINE]`,
      `  • Node MERR Kertajaya      : 9 ms  [ONLINE]`,
      `Semua node merespons dalam <15ms.`
    ];
    color = "var(--success)";
  } else if (lower === '/telemetry' || lower === 'telemetry') {
    responseLines = [
      `Ringkasan Telemetri SITS (${time}):`,
      `  • Beban Jaringan : ${backendState.state.networkLoad}%`,
      `  • Waktu Tunggu   : ${backendState.state.avgWaitTime}s`,
      `  • Indeks Macet   : ${backendState.state.congestionIndex}`,
      `  • Total Kendaraan: ${backendState.state.vehiclesToday.toLocaleString('id-ID')}`
    ];
    color = "var(--text)";
  } else if (lower === '/nodes' || lower === 'nodes') {
    responseLines = [
      `Daftar Edge Cluster Nodes Active:`,
      `  [NODE-01] Wonokromo  (Status: ${backendState.state.intersections[0].status})`,
      `  [NODE-02] Margorejo  (Status: ${backendState.state.intersections[1].status})`,
      `  [NODE-03] Raya Darmo (Status: ${backendState.state.intersections[2].status})`,
      `  [NODE-04] Tunjungan  (Status: ${backendState.state.intersections[3].status})`,
      `  [NODE-05] MERR       (Status: ${backendState.state.intersections[4].status})`
    ];
    color = "var(--primary-2)";
  } else if (lower === '/chaos' || lower === 'chaos') {
    responseLines = [
      `Status Mode Keos: ${backendState.state.isChaosMode ? 'AKTIF (Level ' + backendState.state.chaosLevel + ')' : 'NON-AKTIF (Sistem Normal)'}`
    ];
    color = backendState.state.isChaosMode ? "var(--danger)" : "var(--success)";
  } else if (lower === '/clear' || lower === 'clear') {
    responseLines = ["CLEAR_TERMINAL"];
  }

  // Audit Log Entry
  const auditRecord = {
    operator: act,
    action: "TERMINAL_EXECUTE",
    entity: `Terminal ${executionId}`,
    result: `SUCCESS (Command '${cmd}' executed)`,
    timestamp: new Date().toISOString()
  };
  backendState.auditLogs.unshift(auditRecord);

  // Broadcast terminal event to other clients via socket if not clear
  if (lower !== '/clear' && lower !== 'clear') {
    io.emit('audit:log', {
      type: "terminal:executed",
      timestamp: new Date().toISOString(),
      entity: `Terminal ${executionId}`,
      source: act,
      reasonCode: "TERM_CMD",
      result: "SUCCESS",
      correlationId: executionId,
      details: `Terminal command '${cmd}' executed successfully.`
    });
  }

  res.json({
    success: true,
    executionId,
    command: cmd,
    timestamp: time,
    output: responseLines,
    color: color
  });
});

// Fallback to index.html for all GET routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

function startServer(port) {
  const s = server.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Enterprise Server Running at http://localhost:${port}`);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`⚠️ Port ${PORT} sedang dipakai, mencoba kembali dalam 500ms...`);
    setTimeout(() => {
      server.close();
      startServer(PORT);
    }, 500);
  } else {
    console.error('Server error:', err);
  }
});

startServer(PORT);

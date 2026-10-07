/**
 * OmniTRAF SITS Surabaya - Frontend Canonical Domain Models & Normalizers (Phase 2)
 * Mirror of server canonical domain definitions for pure frontend/browser execution
 */

export const PROVENANCE_VALUES = Object.freeze([
  'LIVE',
  'REALTIME-DERIVED',
  'SIMULATED',
  'STALE',
  'OFFLINE',
  'USER-TRIGGERED'
]);

export function normalizeProvenance(raw, fallback = 'REALTIME-DERIVED') {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  const upper = raw.trim().toUpperCase();
  if (PROVENANCE_VALUES.includes(upper)) return upper;
  if (upper === 'SERVER' || upper === 'SOCKET') return 'SIMULATED';
  if (upper === 'LOCAL-SIMULATOR' || upper === 'SIM') return 'SIMULATED';
  return fallback;
}

export function normalizeTimestampMs(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

export function normalizeIsoTimestamp(raw) {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString();
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return new Date(raw).toISOString();
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

export function normalizeCanonicalTelemetry(raw = {}) {
  const source = raw.source || raw.lastTelemetrySource || 'server';
  const provenance = normalizeProvenance(raw.provenance, 'SIMULATED');
  const updatedAt = normalizeIsoTimestamp(raw.updatedAt || raw.timestampMs || raw.timestamp);
  const timestamp = typeof raw.timestamp === 'string' && raw.timestamp.includes(':') 
    ? raw.timestamp 
    : (new Date(updatedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' }) + ' WIB');

  return {
    timestamp,
    timestampMs: normalizeTimestampMs(raw.timestampMs || updatedAt),
    traffic: {
      networkLoad: Number(raw.networkLoad ?? raw.traffic?.networkLoad ?? 72),
      avgWaitTime: Number(raw.avgWaitTime ?? raw.traffic?.avgWaitTime ?? 42),
      congestionIndex: Number(raw.congestionIndex ?? raw.traffic?.congestionIndex ?? 62),
      vehiclesToday: Number(raw.vehiclesToday ?? raw.traffic?.vehiclesToday ?? 128540)
    },
    sustainability: {
      co2SavedKg: Number(raw.co2SavedKg ?? raw.sustainability?.co2SavedKg ?? 1420),
      fuelSavedLiters: Number(raw.fuelSavedLiters ?? raw.sustainability?.fuelSavedLiters ?? 580)
    },
    infrastructure: {
      cctvOnline: Number(raw.cctvOnline ?? raw.infrastructure?.cctvOnline ?? 184),
      iotOnline: Number(raw.iotOnline ?? raw.infrastructure?.iotOnline ?? 312),
      sitsUptime: Number(raw.sitsUptime ?? raw.infrastructure?.sitsUptime ?? 99.4)
    },
    ai: {
      score: Number(raw.aiScore ?? raw.ai?.score ?? 92),
      confidence: Number(raw.aiConfidence ?? raw.ai?.confidence ?? 96)
    },
    source,
    provenance,
    updatedAt
  };
}

export function normalizeCanonicalIntersection(raw = {}) {
  const id = String(raw.id || raw.intersectionId || raw.nodeId || 'node-unnamed');
  const name = String(raw.name || raw.intersectionName || id);
  const location = String(raw.location || name);
  const coords = Array.isArray(raw.coordinates) ? raw.coordinates : [Number(raw.lat || -7.2756), Number(raw.lng || 112.7424)];
  const status = String(raw.status || 'Normal');
  const source = String(raw.source || 'server');
  const provenance = normalizeProvenance(raw.provenance, 'SIMULATED');
  const updatedAt = normalizeIsoTimestamp(raw.updatedAt || raw.timestamp || raw.cycleStartTime);

  const rawSignal = raw.signal || {};
  const greenSplit = Number(raw.greenSplit ?? raw.green_split ?? rawSignal.greenSplit ?? 35);
  const yellowDuration = Number(raw.yellowDuration ?? rawSignal.yellowDuration ?? 3);
  const redDuration = Number(raw.redDuration ?? rawSignal.redDuration ?? 25);
  const totalCycleTime = Number(raw.totalCycleTime ?? raw.cycle_time ?? rawSignal.cycleTime ?? (greenSplit + yellowDuration + redDuration));
  const timer = raw.timer !== undefined ? raw.timer : (rawSignal.timer ?? greenSplit);
  const state = String(raw.state || rawSignal.state || 'green');
  const controlMode = String(raw.controlMode || raw.mode || rawSignal.controlMode || 'ADAPTIVE_AI');
  const isPreempted = !!(raw.isPreempted ?? rawSignal.isPreempted ?? (raw.status === 'Preemption Aktif'));
  const isOverrideActive = !!(raw.isOverrideActive ?? raw.overrideDuration > 0 ?? rawSignal.isOverrideActive);

  const rawTraffic = raw.traffic || {};
  const waitTime = Number(raw.waitTime ?? rawTraffic.waitTime ?? 35);
  const congestionIndex = Number(rawTraffic.congestionIndex ?? Math.min(100, Math.round(waitTime * 1.4)));
  const speed = Number(rawTraffic.speed ?? (congestionIndex > 70 ? 18 : 38));
  const density = String(rawTraffic.density || (congestionIndex > 70 ? 'High' : 'Normal'));

  return {
    id,
    name,
    location,
    coordinates: coords,
    status,
    source,
    provenance,
    updatedAt,
    signal: {
      state,
      timer,
      greenSplit,
      yellowDuration,
      redDuration,
      cycleTime: totalCycleTime,
      controlMode,
      override: {
        active: isOverrideActive,
        startTime: raw.overrideStartTime || null,
        duration: Number(raw.overrideDuration || 0)
      },
      preemption: {
        active: isPreempted,
        vehicleId: raw.preemptionVehicleId || null
      },
      pendingGreenSplit: raw.pendingGreenSplit ?? null
    },
    traffic: {
      waitTime,
      congestionIndex,
      speed,
      density
    }
  };
}

export function normalizeCanonicalDevice(raw = {}) {
  const id = String(raw.id || raw.deviceId || 'DEV-UNKNOWN');
  const name = String(raw.name || raw.deviceName || id);
  const type = String(raw.type || 'IoT Node');
  const location = String(raw.location || 'Surabaya');
  const coordinates = Array.isArray(raw.coordinates) ? raw.coordinates : [Number(raw.lat || -7.2756), Number(raw.lng || 112.7424)];
  const status = String(raw.status || 'ONLINE').toUpperCase();
  const firmwareVersion = String(raw.firmwareVersion || raw.firmware || 'v1.0.0-sits');
  const streamStatus = String(raw.streamStatus || (status === 'ONLINE' ? 'ONLINE' : 'DEGRADED'));
  const source = String(raw.source || 'REALTIME-DERIVED');
  const provenance = normalizeProvenance(raw.provenance, 'SIMULATED');
  const updatedAt = normalizeIsoTimestamp(raw.updatedAt || raw.lastSeenAt);

  const rawTel = raw.telemetry || {};
  const latencyMs = Number(raw.latencyMs ?? raw.ping_ms ?? rawTel.latencyMs ?? 12);
  const fps = Number(raw.fps ?? rawTel.fps ?? 0);
  const temperatureC = Number(raw.temperatureC ?? rawTel.temperatureC ?? 42);
  const cpuPercent = Number(raw.cpuPercent ?? rawTel.cpuPercent ?? 45);
  const memoryPercent = Number(raw.memoryPercent ?? rawTel.memoryPercent ?? 45);
  const packetLossPercent = Number(raw.packetLossPercent ?? rawTel.packetLossPercent ?? 0);
  const battery = Number(raw.battery ?? rawTel.battery ?? 100);

  const rawHealth = raw.health || {};
  const score = Number(raw.healthScore ?? rawHealth.score ?? (status === 'OFFLINE' ? 0 : 95));
  const level = String(raw.healthLevel ?? rawHealth.level ?? (score >= 85 ? 'HEALTHY' : score > 0 ? 'DEGRADED' : 'OFFLINE')).toUpperCase();
  const errorCount = Number(raw.errorCount ?? rawHealth.errorCount ?? 0);
  const consecutiveFailures = Number(raw.consecutiveFailures ?? rawHealth.consecutiveFailures ?? 0);

  const history = Array.isArray(raw.history) ? [...raw.history] : [latencyMs];

  return {
    id,
    name,
    type,
    location,
    coordinates,
    status,
    telemetry: {
      latencyMs,
      fps,
      temperatureC,
      cpuPercent,
      memoryPercent,
      packetLossPercent,
      battery
    },
    health: {
      score,
      level,
      errorCount,
      consecutiveFailures
    },
    firmwareVersion,
    resolution: raw.resolution || (type.includes('PLC') ? 'N/A' : '1080p'),
    greenWaveSync: raw.greenWaveSync !== undefined ? !!raw.greenWaveSync : true,
    streamStatus,
    history,
    lastSeenAt: normalizeIsoTimestamp(raw.lastSeenAt || updatedAt),
    lastHeartbeatAt: normalizeIsoTimestamp(raw.lastHeartbeatAt || updatedAt),
    updatedAt,
    source,
    provenance
  };
}

export function normalizeCanonicalCctv(raw = {}) {
  const id = String(raw.id || raw.cameraId || 'cctvCanvas1');
  const name = String(raw.name || raw.cameraName || `Kamera ${id}`);
  const location = String(raw.location || 'Surabaya');
  const status = String(raw.status || raw.streamStatus || 'ONLINE').toUpperCase();
  const source = String(raw.source || 'SITS Edge Vision YOLOv8');
  const provenance = normalizeProvenance(raw.provenance, 'SIMULATED');
  const updatedAt = normalizeIsoTimestamp(raw.updatedAt || raw.timestamp);

  const rawTelemetry = raw.telemetry || {};
  const fps = Number(raw.fps ?? rawTelemetry.fps ?? 30);
  const processingLatencyMs = Number(raw.processingLatencyMs ?? rawTelemetry.processingLatencyMs ?? 5);
  const resolution = String(raw.resolution || rawTelemetry.resolution || '1920x1080');

  const detections = Array.isArray(raw.detections) 
    ? raw.detections.map(d => ({
        id: String(d.id || d.trackId),
        trackId: String(d.trackId || d.id),
        class: String(d.class || 'car'),
        confidence: Number(d.confidence || 90),
        boundingBox: {
          x: Number(d.x ?? d.boundingBox?.x ?? 0),
          y: Number(d.y ?? d.boundingBox?.y ?? 0),
          w: Number(d.w ?? d.width ?? d.boundingBox?.w ?? 0.1),
          h: Number(d.h ?? d.height ?? d.boundingBox?.h ?? 0.1)
        },
        speedKmh: Number(d.speedKmh ?? 40)
      }))
    : [];

  return {
    camera: {
      id,
      name,
      location,
      status
    },
    frame: {
      sequence: Number(raw.sequence || raw.seq || 0),
      timestamp: normalizeIsoTimestamp(raw.timestamp || updatedAt),
      resolution,
      source
    },
    detections,
    telemetry: {
      fps,
      processingLatencyMs,
      streamStatus: status
    },
    source,
    provenance,
    updatedAt
  };
}

export function normalizeCanonicalIncident(raw = {}) {
  const id = String(raw.id || `INC-${Date.now()}`);
  const title = String(raw.title || `Insiden #${id}`);
  const category = String(raw.category || raw.type || 'congestion').toLowerCase();
  const location = String(raw.location || 'Surabaya');
  const coordinates = Array.isArray(raw.coordinates) ? raw.coordinates : [Number(raw.lat || -7.2756), Number(raw.lng || 112.7424)];

  let rawStatus = String(raw.status || 'ACTIVE').trim().toUpperCase();
  if (rawStatus === 'OPEN') rawStatus = 'ACTIVE';
  if (rawStatus === 'DISPATCHED/RESPONDING') rawStatus = 'DISPATCHED';
  const status = rawStatus;

  const severity = String(raw.severity || 'medium').toLowerCase();
  const priority = String(raw.priority || (severity === 'critical' || severity === 'danger' ? 'high' : 'medium')).toLowerCase();
  const source = String(raw.source || 'SITS Core');
  const provenance = normalizeProvenance(raw.provenance, 'SIMULATED');
  const operator = String(raw.assignedUnit || raw.operator || 'Petugas SITS');
  const notes = String(raw.notes || '');

  const createdAt = normalizeIsoTimestamp(raw.createdAt || raw.reportedAt || raw.time || Date.now());
  const updatedAt = normalizeIsoTimestamp(raw.updatedAt || raw.time || createdAt);
  const acknowledgedAt = raw.acknowledgedAt ? normalizeIsoTimestamp(raw.acknowledgedAt) : (status === 'ACKNOWLEDGED' || status === 'DISPATCHED' ? updatedAt : null);
  const resolvedAt = raw.resolvedAt ? normalizeIsoTimestamp(raw.resolvedAt) : (status === 'RESOLVED' || status === 'ARCHIVED' ? updatedAt : null);

  return {
    id,
    type: category,
    category,
    title,
    location,
    coordinates,
    status,
    severity,
    priority,
    source,
    provenance,
    operator,
    assignedUnit: operator,
    notes,
    createdAt,
    reportedAt: createdAt,
    updatedAt,
    acknowledgedAt,
    resolvedAt
  };
}

export function normalizeCanonicalEmergency(raw = {}) {
  const id = String(raw.id || raw.code || `EMG-${Date.now()}`);
  const vehicleId = String(raw.vehicleId || raw.code || id);
  const vehicleType = String(raw.vehicleType || raw.type || 'Ambulans RSU Dr. Soetomo');
  const routeId = String(raw.routeId || raw.route || 'route-soetomo');

  let rawStatus = String(raw.status || 'EN_ROUTE').trim().toUpperCase();
  if (rawStatus === 'PRIORITAS AKTIF') rawStatus = 'ROUTE_PREEMPTION';
  const status = rawStatus;

  const eta = String(raw.eta || raw.ETA || '0s');
  const speed = Number(raw.speed ?? 55);
  const priority = String(raw.priority || 'CRITICAL').toUpperCase();
  const source = String(raw.source || '112 Surabaya');
  const provenance = normalizeProvenance(raw.provenance, 'SIMULATED');
  const startedAt = normalizeIsoTimestamp(raw.startedAt || raw.timestamp || Date.now());
  const updatedAt = normalizeIsoTimestamp(raw.updatedAt || startedAt);

  const coordinates = Array.isArray(raw.currentPosition) ? raw.currentPosition : [Number(raw.lat || -7.3180), Number(raw.lng || 112.7330)];

  return {
    id,
    vehicleId,
    vehicleType,
    vehicle: vehicleType,
    routeId,
    route: routeId,
    status,
    eta,
    ETA: eta,
    speed,
    priority,
    progress: Number(raw.progress || 0),
    currentPosition: coordinates,
    nextIntersection: raw.nextIntersection || null,
    preemption: {
      active: status === 'ROUTE_PREEMPTION' || status === 'EN_ROUTE',
      corridorId: routeId
    },
    source,
    provenance,
    startedAt,
    updatedAt
  };
}

export function createNormalizedCollection(items = [], keySelector = (item) => item.id) {
  const byId = {};
  const allIds = [];
  const seenIds = new Set();

  for (const item of items) {
    if (!item) continue;
    const key = keySelector(item);
    if (key !== undefined && key !== null) {
      const strKey = String(key);
      byId[strKey] = item;
      if (!seenIds.has(strKey)) {
        allIds.push(strKey);
        seenIds.add(strKey);
      }
    }
  }

  return { byId, allIds };
}

export const CompatibilityAdapters = {
  toLegacyIntersection(canonical) {
    if (!canonical) return null;
    return {
      id: canonical.id,
      name: canonical.name,
      state: canonical.signal.state,
      timer: canonical.signal.timer,
      greenSplit: canonical.signal.greenSplit,
      waitTime: canonical.traffic.waitTime,
      status: canonical.status,
      redDuration: canonical.signal.redDuration,
      yellowDuration: canonical.signal.yellowDuration,
      totalCycleTime: canonical.signal.cycleTime,
      isPreempted: canonical.signal.preemption.active,
      preemptionVehicleId: canonical.signal.preemption.vehicleId,
      isOverrideActive: canonical.signal.override.active,
      overrideDuration: canonical.signal.override.duration,
      overrideStartTime: canonical.signal.override.startTime,
      pendingGreenSplit: canonical.signal.pendingGreenSplit,
      signal: canonical.signal,
      traffic: canonical.traffic,
      coordinates: canonical.coordinates,
      updatedAt: canonical.updatedAt
    };
  },

  toLegacyDevice(canonical) {
    if (!canonical) return null;
    return {
      deviceId: canonical.id,
      deviceName: canonical.name,
      type: canonical.type,
      location: canonical.location,
      coordinates: canonical.coordinates,
      status: canonical.status,
      lastSeenAt: canonical.lastSeenAt,
      lastHeartbeatAt: canonical.lastHeartbeatAt,
      latencyMs: canonical.telemetry.latencyMs,
      packetLossPercent: canonical.telemetry.packetLossPercent,
      fps: canonical.telemetry.fps,
      resolution: canonical.resolution,
      temperatureC: canonical.telemetry.temperatureC,
      cpuPercent: canonical.telemetry.cpuPercent,
      memoryPercent: canonical.telemetry.memoryPercent,
      uptimePercent: 99.8,
      firmwareVersion: canonical.firmwareVersion,
      streamStatus: canonical.streamStatus,
      greenWaveSync: canonical.greenWaveSync,
      errorCount: canonical.health.errorCount,
      consecutiveFailures: canonical.health.consecutiveFailures,
      healthScore: canonical.health.score,
      healthLevel: canonical.health.level,
      history: canonical.history,
      source: canonical.source,
      provenance: canonical.provenance,
      updatedAt: canonical.updatedAt,
      telemetry: canonical.telemetry,
      health: canonical.health
    };
  },

  toLegacyIncident(canonical) {
    if (!canonical) return null;
    return {
      id: canonical.id,
      title: canonical.title,
      category: canonical.category,
      type: canonical.type,
      severity: canonical.severity,
      location: canonical.location,
      coordinates: canonical.coordinates,
      status: canonical.status,
      priority: canonical.priority,
      source: canonical.source,
      provenance: canonical.provenance,
      assignedUnit: canonical.assignedUnit,
      operator: canonical.operator,
      notes: canonical.notes,
      reportedAt: canonical.reportedAt,
      createdAt: canonical.createdAt,
      updatedAt: canonical.updatedAt,
      acknowledgedAt: canonical.acknowledgedAt,
      resolvedAt: canonical.resolvedAt
    };
  },

  toLegacyEmergency(canonical) {
    if (!canonical) return null;
    return {
      id: canonical.id,
      code: canonical.vehicleId,
      vehicleId: canonical.vehicleId,
      vehicle: canonical.vehicleType,
      vehicleType: canonical.vehicleType,
      route: canonical.routeId,
      routeId: canonical.routeId,
      status: canonical.status,
      eta: canonical.eta,
      ETA: canonical.eta,
      speed: canonical.speed,
      progress: canonical.progress,
      currentPosition: canonical.currentPosition,
      nextIntersection: canonical.nextIntersection,
      source: canonical.source,
      provenance: canonical.provenance,
      startedAt: canonical.startedAt,
      updatedAt: canonical.updatedAt,
      timestamp: canonical.startedAt
    };
  },

  toLegacyTelemetry(canonical) {
    if (!canonical) return null;
    return {
      timestamp: canonical.timestamp,
      networkLoad: canonical.traffic.networkLoad,
      avgWaitTime: canonical.traffic.avgWaitTime,
      congestionIndex: canonical.traffic.congestionIndex,
      vehiclesToday: canonical.traffic.vehiclesToday,
      co2SavedKg: canonical.sustainability.co2SavedKg,
      fuelSavedLiters: canonical.sustainability.fuelSavedLiters,
      cctvOnline: canonical.infrastructure.cctvOnline,
      iotOnline: canonical.infrastructure.iotOnline,
      sitsUptime: canonical.infrastructure.sitsUptime,
      sitsSignal: 94,
      aiScore: canonical.ai.score,
      aiConfidence: canonical.ai.confidence,
      source: canonical.source,
      provenance: canonical.provenance,
      updatedAt: canonical.updatedAt
    };
  }
};

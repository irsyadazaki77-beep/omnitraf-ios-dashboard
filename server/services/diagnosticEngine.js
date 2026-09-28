/**
 * OmniTRAF SITS Surabaya - Diagnostics & Chaos Matrix Engine (Phase 17 Hardened)
 * 
 * Provides:
 * - Structured Diagnostic Event Model (DEBUG, INFO, WARN, ERROR, CRITICAL)
 * - Event classification: operational, state_transition, performance, security, fault
 * - Bounded rolling metric counters (latencies, counts, failure classes)
 * - Safe Diagnostic Snapshot capture with automatic redaction
 * - Deterministic Fault Injection Layer (Development/Test/Chaos only)
 * - Health and Readiness check aggregators across subsystems
 */

export const DIAGNOSTIC_LEVELS = Object.freeze({
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL'
});

export const EVENT_CATEGORIES = Object.freeze({
  OPERATIONAL: 'operational',
  STATE_TRANSITION: 'state_transition',
  PERFORMANCE: 'performance',
  SECURITY: 'security',
  FAULT: 'fault'
});

export const SUBSYSTEMS = Object.freeze({
  DATABASE: 'database',
  PERSISTENCE: 'persistence',
  STATE_STORE: 'state_store',
  STATE_MANAGER: 'state_manager',
  SOCKET: 'socket',
  SSE: 'sse',
  AUTH: 'auth',
  COMMAND_PIPELINE: 'command_pipeline',
  INCIDENT: 'incident',
  EMERGENCY: 'emergency',
  DEVICE: 'device',
  SIGNAL: 'signal',
  CCTV: 'cctv',
  MAP: 'map',
  ANALYTICS: 'analytics',
  REPORT: 'report'
});

export const HEALTH_STATUS = Object.freeze({
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  UNAVAILABLE: 'UNAVAILABLE',
  STARTING: 'STARTING',
  RECOVERING: 'RECOVERING',
  UNKNOWN: 'UNKNOWN'
});

/**
 * Redact sensitive fields (JWT, passwords, secrets, tokens, file paths)
 */
export function sanitizeDiagnosticData(data) {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') {
    if (typeof data === 'string') {
      return data
        .replace(/Bearer\s+[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/gi, 'Bearer [REDACTED]')
        .replace(/([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi, '[REDACTED_EMAIL]')
        .replace(/([A-Z]:\\[^"'\n\r\t]+)/gi, '[REDACTED_PATH]');
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.slice(0, 50).map(sanitizeDiagnosticData);
  }

  const sanitized = {};
  const sensitiveKeys = new Set([
    'password', 'passwordhash', 'token', 'jwt', 'secret', 'auth',
    'authorization', 'apikey', 'credentials', 'cookie', 'sessionid'
  ]);

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.has(lowerKey)) {
      sanitized[key] = '[REDACTED]';
    } else if (lowerKey === 'frame' || lowerKey === 'image' || lowerKey === 'buffer' || lowerKey === 'imagedata') {
      sanitized[key] = '[BINARY_IMAGE_BUFFER_OMITTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeDiagnosticData(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Structured Diagnostic Event Factory
 */
export function createDiagnosticEvent({
  level = DIAGNOSTIC_LEVELS.INFO,
  category = EVENT_CATEGORIES.OPERATIONAL,
  component,
  event,
  operation = null,
  commandId = null,
  correlationId = null,
  entityType = null,
  entityId = null,
  source = 'system',
  stateVersion = null,
  sequence = null,
  durationMs = null,
  errorCode = null,
  message,
  details = null
}) {
  return Object.freeze({
    timestamp: new Date().toISOString(),
    timestampMs: Date.now(),
    level: DIAGNOSTIC_LEVELS[level] || DIAGNOSTIC_LEVELS.INFO,
    category: EVENT_CATEGORIES[category.toUpperCase()] || category || EVENT_CATEGORIES.OPERATIONAL,
    component: component || 'core',
    event: event || 'EVENT',
    operation,
    commandId,
    correlationId,
    entityType,
    entityId,
    source,
    stateVersion: stateVersion ?? sequence ?? null,
    sequence: sequence ?? stateVersion ?? null,
    durationMs: typeof durationMs === 'number' ? Number(durationMs.toFixed(2)) : null,
    errorCode: errorCode || null,
    message: typeof message === 'string' ? message : '',
    details: sanitizeDiagnosticData(details)
  });
}

/**
 * Diagnostic Engine Singleton
 */
export class DiagnosticEngine {
  constructor() {
    this.maxEvents = 200;
    this.events = []; // Ring buffer for structured events
    this.metrics = {
      commandSuccessCount: 0,
      commandFailureCount: 0,
      commandLatency: [], // rolling 50
      ackLatency: [],     // rolling 50
      persistenceLatency: [], // rolling 50
      stateTransitionCount: 0,
      rejectedTransitionCount: 0,
      reconnectCount: 0,
      resyncCount: 0,
      duplicateEventsDropped: 0,
      staleEventsDropped: 0,
      socketLatencyMs: 12,
      sseReconnectCount: 0,
      activeClients: 0,
      errorCountBySubsystem: {},
      faultInjectionsCount: 0,
      recoveryAttempts: 0,
      recoverySuccessCount: 0,
      recoveryFailureCount: 0,
      lastRenderFps: 60,
      lastFrameTimeMs: 16.6,
      mapUpdateDurationMs: 0
    };

    // Subsystem Health Tracker
    this.subsystems = new Map();
    Object.values(SUBSYSTEMS).forEach(sub => {
      this.subsystems.set(sub, {
        status: HEALTH_STATUS.HEALTHY,
        lastCheckAt: Date.now(),
        detail: 'Initialized',
        errorCount: 0
      });
    });

    // Active Fault Injections (Deterministic Testing Mode)
    this.activeFaults = new Map();
  }

  /**
   * Log a structured diagnostic event into the bounded ring buffer
   */
  logEvent(params) {
    const evt = createDiagnosticEvent(params);
    this.events.unshift(evt);
    if (this.events.length > this.maxEvents) {
      this.events.pop();
    }

    // Update subsystem error counters
    if (evt.level === DIAGNOSTIC_LEVELS.ERROR || evt.level === DIAGNOSTIC_LEVELS.CRITICAL) {
      const sub = evt.component || 'core';
      this.metrics.errorCountBySubsystem[sub] = (this.metrics.errorCountBySubsystem[sub] || 0) + 1;
      const subHealth = this.subsystems.get(sub);
      if (subHealth) {
        subHealth.errorCount++;
        subHealth.status = evt.level === DIAGNOSTIC_LEVELS.CRITICAL ? HEALTH_STATUS.UNAVAILABLE : HEALTH_STATUS.DEGRADED;
        subHealth.detail = evt.message;
        subHealth.lastCheckAt = Date.now();
      }
    }

    return evt;
  }

  setSubsystemHealth(name, status, detail = '') {
    const current = this.subsystems.get(name) || { errorCount: 0 };
    this.subsystems.set(name, {
      status,
      lastCheckAt: Date.now(),
      detail: detail || `Status updated to ${status}`,
      errorCount: status === HEALTH_STATUS.HEALTHY ? 0 : current.errorCount
    });
  }

  recordCommandOutcome(success, latencyMs, action = '', correlationId = null) {
    if (success) {
      this.metrics.commandSuccessCount++;
    } else {
      this.metrics.commandFailureCount++;
    }
    if (typeof latencyMs === 'number' && latencyMs >= 0) {
      this.metrics.commandLatency.push(Number(latencyMs.toFixed(1)));
      if (this.metrics.commandLatency.length > 50) this.metrics.commandLatency.shift();
    }
  }

  recordPersistenceLatency(latencyMs) {
    if (typeof latencyMs === 'number' && latencyMs >= 0) {
      this.metrics.persistenceLatency.push(Number(latencyMs.toFixed(1)));
      if (this.metrics.persistenceLatency.length > 50) this.metrics.persistenceLatency.shift();
    }
  }

  recordStateTransition(valid = true, entity = '', oldState = '', newState = '', correlationId = null) {
    if (valid) {
      this.metrics.stateTransitionCount++;
      this.logEvent({
        level: DIAGNOSTIC_LEVELS.INFO,
        category: EVENT_CATEGORIES.STATE_TRANSITION,
        component: SUBSYSTEMS.STATE_MANAGER,
        event: 'STATE_TRANSITION_APPLIED',
        entityType: entity,
        correlationId,
        message: `State transition applied: ${oldState} -> ${newState}`
      });
    } else {
      this.metrics.rejectedTransitionCount++;
      this.logEvent({
        level: DIAGNOSTIC_LEVELS.WARN,
        category: EVENT_CATEGORIES.STATE_TRANSITION,
        component: SUBSYSTEMS.STATE_MANAGER,
        event: 'STATE_TRANSITION_REJECTED',
        entityType: entity,
        correlationId,
        message: `Invalid state transition rejected: ${oldState} -> ${newState}`
      });
    }
  }

  recordRecoveryAttempt(subsystem, success = true, durationMs = 0, details = '') {
    this.metrics.recoveryAttempts++;
    if (success) {
      this.metrics.recoverySuccessCount++;
      this.setSubsystemHealth(subsystem, HEALTH_STATUS.HEALTHY, `Recovered successfully: ${details}`);
      this.logEvent({
        level: DIAGNOSTIC_LEVELS.INFO,
        category: EVENT_CATEGORIES.OPERATIONAL,
        component: subsystem,
        event: 'SUBSYSTEM_RECOVERED',
        durationMs,
        message: `Subsystem ${subsystem} recovered. ${details}`
      });
    } else {
      this.metrics.recoveryFailureCount++;
      this.setSubsystemHealth(subsystem, HEALTH_STATUS.DEGRADED, `Recovery attempt failed: ${details}`);
      this.logEvent({
        level: DIAGNOSTIC_LEVELS.ERROR,
        category: EVENT_CATEGORIES.OPERATIONAL,
        component: subsystem,
        event: 'SUBSYSTEM_RECOVERY_FAILED',
        durationMs,
        message: `Subsystem ${subsystem} recovery attempt failed. ${details}`
      });
    }
  }

  /**
   * Deterministic Fault Injection (Development / Test / Explicit Chaos Mode Only)
   */
  injectFault({
    faultId,
    targetSubsystem,
    intendedEffect,
    durationMs = 15000,
    deterministicSeed = 42,
    params = {}
  }) {
    const isTestOrDev = process.env.NODE_ENV === 'test' || 
                        process.env.NODE_ENV === 'development' || 
                        process.env.PORT === '0' || 
                        (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'));

    if (!isTestOrDev && process.env.ENABLE_CHAOS_MODE !== 'true') {
      throw new Error('FAULT_INJECTION_PROHIBITED: Fault injection is strictly disabled outside development/test/chaos mode.');
    }

    const fid = faultId || `FLT-${Date.now()}-${targetSubsystem}`;
    const fault = {
      faultId: fid,
      targetSubsystem,
      intendedEffect,
      durationMs,
      deterministicSeed,
      params,
      injectedAt: Date.now(),
      status: 'ACTIVE'
    };

    this.activeFaults.set(fid, fault);
    this.metrics.faultInjectionsCount++;

    this.setSubsystemHealth(targetSubsystem, HEALTH_STATUS.DEGRADED, `Injected fault: ${intendedEffect}`);

    this.logEvent({
      level: DIAGNOSTIC_LEVELS.WARN,
      category: EVENT_CATEGORIES.FAULT,
      component: targetSubsystem,
      event: 'FAULT_INJECTED',
      operation: 'injectFault',
      message: `Fault ${fid} injected on ${targetSubsystem}: ${intendedEffect}`,
      details: fault
    });

    return fault;
  }

  clearFault(faultId) {
    const fault = this.activeFaults.get(faultId);
    if (!fault) return false;

    this.activeFaults.delete(faultId);
    this.recordRecoveryAttempt(fault.targetSubsystem, true, Date.now() - fault.injectedAt, `Fault ${faultId} cleared.`);
    return true;
  }

  clearAllFaults() {
    const count = this.activeFaults.size;
    this.activeFaults.forEach((fault, fid) => {
      this.clearFault(fid);
    });
    this.activeFaults.clear();
    return count;
  }

  isFaultActive(targetSubsystem, intendedEffect = null) {
    for (const fault of this.activeFaults.values()) {
      if (fault.targetSubsystem === targetSubsystem) {
        if (!intendedEffect || fault.intendedEffect === intendedEffect) {
          return true;
        }
      }
    }
    return false;
  }

  getActiveFault(targetSubsystem, intendedEffect = null) {
    for (const fault of this.activeFaults.values()) {
      if (fault.targetSubsystem === targetSubsystem) {
        if (!intendedEffect || fault.intendedEffect === intendedEffect) {
          return fault;
        }
      }
    }
    return null;
  }

  /**
   * Diagnostic Snapshot: Captures current system condition safely and concisely
   */
  captureSnapshot(context = {}) {
    const subsystemStatus = {};
    this.subsystems.forEach((val, key) => {
      subsystemStatus[key] = {
        status: val.status,
        detail: val.detail,
        errorCount: val.errorCount,
        lastCheckSecAgo: Math.round((Date.now() - val.lastCheckAt) / 1000)
      };
    });

    const activeFaultsList = Array.from(this.activeFaults.values()).map(f => ({
      faultId: f.faultId,
      target: f.targetSubsystem,
      effect: f.intendedEffect,
      activeSec: Math.round((Date.now() - f.injectedAt) / 1000)
    }));

    return sanitizeDiagnosticData({
      timestamp: new Date().toISOString(),
      activeFaultsCount: this.activeFaults.size,
      activeFaults: activeFaultsList,
      subsystems: subsystemStatus,
      metrics: {
        commandSuccessCount: this.metrics.commandSuccessCount,
        commandFailureCount: this.metrics.commandFailureCount,
        avgCommandLatencyMs: this._calcAvg(this.metrics.commandLatency),
        avgPersistenceLatencyMs: this._calcAvg(this.metrics.persistenceLatency),
        stateTransitionCount: this.metrics.stateTransitionCount,
        rejectedTransitionCount: this.metrics.rejectedTransitionCount,
        reconnectCount: this.metrics.reconnectCount,
        resyncCount: this.metrics.resyncCount,
        duplicateEventsDropped: this.metrics.duplicateEventsDropped,
        staleEventsDropped: this.metrics.staleEventsDropped,
        recoverySuccessRate: this.metrics.recoveryAttempts > 0 
          ? `${Math.round((this.metrics.recoverySuccessCount / this.metrics.recoveryAttempts) * 100)}%` 
          : '100%'
      },
      recentEvents: this.events.slice(0, 15),
      context: sanitizeDiagnosticData(context)
    });
  }

  _calcAvg(arr) {
    if (!arr || arr.length === 0) return 0;
    const sum = arr.reduce((acc, v) => acc + v, 0);
    return Number((sum / arr.length).toFixed(1));
  }

  reset() {
    this.events = [];
    this.activeFaults.clear();
    this.metrics.commandSuccessCount = 0;
    this.metrics.commandFailureCount = 0;
    this.metrics.commandLatency = [];
    this.metrics.ackLatency = [];
    this.metrics.persistenceLatency = [];
    this.metrics.stateTransitionCount = 0;
    this.metrics.rejectedTransitionCount = 0;
    this.metrics.reconnectCount = 0;
    this.metrics.resyncCount = 0;
    this.metrics.duplicateEventsDropped = 0;
    this.metrics.staleEventsDropped = 0;
    this.metrics.faultInjectionsCount = 0;
    this.metrics.recoveryAttempts = 0;
    this.metrics.recoverySuccessCount = 0;
    this.metrics.recoveryFailureCount = 0;
    Object.values(SUBSYSTEMS).forEach(sub => {
      this.setSubsystemHealth(sub, HEALTH_STATUS.HEALTHY, 'Reset');
    });
  }
}

export const diagnosticEngine = new DiagnosticEngine();

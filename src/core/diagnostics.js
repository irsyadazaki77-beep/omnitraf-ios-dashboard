/**
 * OmniTRAF Surabaya - Internal Runtime Diagnostics & Reliability Registry (Phase 18 Hardened)
 * Telemetry tracker for performance, realtime ordering, connection health & lifecycle metrics:
 * - lastEventTimestamp, lastAcceptedSequence per domain, lastDroppedEvent
 * - reconnectCount, resyncCount, resyncFailureCount, heartbeatLatencyMs, staleDurationMs
 * - cctvDroppedFrames, pendingCommandCount, duplicateEventCount
 * - initCount, activeTimers, activeSocketListeners, activeAnimationFrames
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

class DiagnosticsManager {
  constructor() {
    this.initCount = 0;
    this.activeTimers = new Set();
    this.activeAnimationFrames = new Set();
    this.activeSocketListenersCount = 0;
    this.domUpdateCount = 0;
    this.cctvDroppedFrames = 0;
    this.apiRequestCount = 0;
    this.apiErrorCount = 0;
    this.lastRenderDuration = 0;
    this.startTime = Date.now();

    // Structured Event Ring Buffer (Bounded 100 items)
    this.maxEvents = 100;
    this.events = [];

    // Phase 18 Realtime Reliability & Ordering Diagnostics
    this.lastEventTimestamp = 0;
    this.lastAcceptedSequence = {
      traffic: 0,
      cctv: 0,
      incident: 0,
      emergency: 0,
      signal: 0,
      device: 0
    };
    this.lastDroppedEvent = null;
    this.reconnectCount = 0;
    this.resyncCount = 0;
    this.resyncFailureCount = 0;
    this.heartbeatLatencyMs = 12;
    this.staleDurationMs = 0;
    this.pendingCommandCount = 0;
    this.duplicateEventCount = 0;

    // Phase 16 Performance & Jank Tracking Instrumentation
    this.stateUpdateCount = 0;
    this.lastFps = 60;
    this.fpsCounter = 0;
    this.fpsLastCheck = Date.now();
    this.jankCount = 0; // Frames exceeding 50ms (Long Task budget)
    this.maxFrameTimeMs = 0;
    this.longTaskCount = 0;
    this.maxLongTaskDurationMs = 0;
    this.longTaskObserver = null;
    this.renderTimes = []; // rolling 30 items
    this.activeMapLayersCount = 0;
    this.trackedCctvObjectsCount = 0;

    // Attach to window for debug / terminal access
    if (typeof window !== 'undefined') {
      window.__omnitrafDiagnostics = this;
    }
  }

  /**
   * Log a structured diagnostic event into the frontend ring-buffer
   */
  logEvent({
    level = DIAGNOSTIC_LEVELS.INFO,
    category = EVENT_CATEGORIES.OPERATIONAL,
    component = 'client',
    event = 'EVENT',
    operation = null,
    commandId = null,
    correlationId = null,
    entityType = null,
    entityId = null,
    source = 'client',
    stateVersion = null,
    sequence = null,
    durationMs = null,
    errorCode = null,
    message = '',
    details = null
  }) {
    const diagnosticEvt = Object.freeze({
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),
      level: DIAGNOSTIC_LEVELS[level] || DIAGNOSTIC_LEVELS.INFO,
      category: EVENT_CATEGORIES[category.toUpperCase()] || category || EVENT_CATEGORIES.OPERATIONAL,
      component,
      event,
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

    this.events.unshift(diagnosticEvt);
    if (this.events.length > this.maxEvents) {
      this.events.pop();
    }

    return diagnosticEvt;
  }

  getRecentEvents(limit = 20) {
    return this.events.slice(0, Math.min(limit, this.events.length));
  }

  recordInit(label) {
    this.initCount++;
  }

  incrementInit() {
    this.initCount++;
  }

  recordSocketListener(count = 1) {
    this.activeSocketListenersCount += count;
  }

  removeSocketListener(count = 1) {
    this.activeSocketListenersCount = Math.max(0, this.activeSocketListenersCount - count);
  }

  recordAcceptedEvent(topic, seq, timestamp = Date.now()) {
    this.lastEventTimestamp = timestamp;
    if (topic && this.lastAcceptedSequence[topic] !== undefined) {
      this.lastAcceptedSequence[topic] = Math.max(this.lastAcceptedSequence[topic], seq || 0);
    }
  }

  recordDroppedEvent(topic, seq, reason = 'out_of_order') {
    this.lastDroppedEvent = {
      topic,
      seq,
      reason,
      timestamp: Date.now()
    };
  }

  recordDuplicateEvent(topic, seq) {
    this.duplicateEventCount++;
    this.recordDroppedEvent(topic, seq, 'duplicate');
  }

  recordReconnect() {
    this.reconnectCount++;
  }

  recordResyncAttempt() {
    this.resyncCount++;
  }

  recordResyncFailure() {
    this.resyncFailureCount++;
  }

  recordHeartbeatLatency(latencyMs) {
    this.heartbeatLatencyMs = Math.max(1, Math.round(latencyMs));
  }

  recordStaleDuration(durationMs) {
    this.staleDurationMs = Math.max(0, Math.round(durationMs));
  }

  recordPendingCommandCount(count) {
    this.pendingCommandCount = Math.max(0, count);
  }

  setInterval(fn, ms) {
    const id = setInterval(() => {
      try {
        fn();
      } catch (err) {
        console.error("[Diagnostics] Error in setInterval callback:", err);
      }
    }, ms);
    this.activeTimers.add(id);
    return id;
  }

  clearInterval(id) {
    if (id) {
      clearInterval(id);
      this.activeTimers.delete(id);
    }
  }

  setTimeout(fn, ms) {
    const id = setTimeout(() => {
      this.activeTimers.delete(id);
      try {
        fn();
      } catch (err) {
        console.error("[Diagnostics] Error in setTimeout callback:", err);
      }
    }, ms);
    this.activeTimers.add(id);
    return id;
  }

  clearTimeout(id) {
    if (id) {
      clearTimeout(id);
      this.activeTimers.delete(id);
    }
  }

  requestAnimationFrame(fn) {
    const id = requestAnimationFrame((timestamp) => {
      this.activeAnimationFrames.delete(id);
      try {
        fn(timestamp);
      } catch (err) {
        console.error("[Diagnostics] Error in rAF callback:", err);
      }
    });
    this.activeAnimationFrames.add(id);
    return id;
  }

  cancelAnimationFrame(id) {
    if (id) {
      cancelAnimationFrame(id);
      this.activeAnimationFrames.delete(id);
    }
  }

  recordDomUpdate() {
    this.domUpdateCount++;
  }

  recordDroppedFrame() {
    this.cctvDroppedFrames++;
  }

  recordApiRequest() {
    this.apiRequestCount++;
  }

  recordApiError() {
    this.apiErrorCount++;
  }

  recordStateUpdate() {
    this.stateUpdateCount++;
  }

  recordFrame(frameDurationMs = 16.6) {
    this.fpsCounter++;
    const now = Date.now();
    if (now - this.fpsLastCheck >= 1000) {
      this.lastFps = this.fpsCounter;
      this.fpsCounter = 0;
      this.fpsLastCheck = now;
    }
    if (frameDurationMs > 50) {
      this.jankCount++;
    }
    if (frameDurationMs > this.maxFrameTimeMs) {
      this.maxFrameTimeMs = Number(frameDurationMs.toFixed(1));
    }
  }

  recordRenderDuration(durationMs) {
    this.lastRenderDuration = Number(durationMs.toFixed(2));
    this.renderTimes.push(this.lastRenderDuration);
    if (this.renderTimes.length > 30) {
      this.renderTimes.shift();
    }
    this.recordFrame(durationMs);
  }

  startLongTaskObserver() {
    const search = typeof window !== 'undefined' ? window.location?.search || '' : '';
    if (new URLSearchParams(search).get('diagnostics') !== '1' || this.longTaskObserver) return false;
    if (typeof PerformanceObserver === 'undefined' ||
        !PerformanceObserver.supportedEntryTypes?.includes('longtask')) return false;

    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.longTaskCount++;
          this.maxLongTaskDurationMs = Math.max(this.maxLongTaskDurationMs, Number(entry.duration.toFixed(1)));
        }
      });
      this.longTaskObserver.observe({ type: 'longtask', buffered: true });
      return true;
    } catch (_) {
      this.longTaskObserver = null;
      return false;
    }
  }

  stopLongTaskObserver() {
    this.longTaskObserver?.disconnect();
    this.longTaskObserver = null;
  }

  recordMapLayersCount(count) {
    this.activeMapLayersCount = Math.max(0, count);
  }

  recordTrackedObjectsCount(count) {
    this.trackedCctvObjectsCount = Math.max(0, count);
  }

  getAverageRenderDuration() {
    if (this.renderTimes.length === 0) return 0;
    const sum = this.renderTimes.reduce((acc, v) => acc + v, 0);
    return Number((sum / this.renderTimes.length).toFixed(2));
  }

  getMemoryUsageMB() {
    if (typeof performance !== 'undefined' && performance.memory && performance.memory.usedJSHeapSize) {
      return (performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(1);
    }
    return "N/A";
  }

  getMetricsReport() {
    const uptimeSec = Math.round((Date.now() - this.startTime) / 1000);
    return {
      initCount: this.initCount,
      activeTimers: this.activeTimers.size,
      activeAnimationFrames: this.activeAnimationFrames.size,
      activeSocketListeners: this.activeSocketListenersCount,
      domUpdateCount: this.domUpdateCount,
      stateUpdateCount: this.stateUpdateCount,
      cctvDroppedFrames: this.cctvDroppedFrames,
      apiRequestCount: this.apiRequestCount,
      apiErrorCount: this.apiErrorCount,
      fps: this.lastFps,
      jankCount: this.jankCount,
      maxFrameTimeMs: `${this.maxFrameTimeMs}ms`,
      longTaskCount: this.longTaskCount,
      maxLongTaskDurationMs: `${this.maxLongTaskDurationMs}ms`,
      avgRenderDurationMs: `${this.getAverageRenderDuration()}ms`,
      lastRenderDurationMs: `${this.lastRenderDuration}ms`,
      activeMapLayers: this.activeMapLayersCount,
      trackedCctvObjects: this.trackedCctvObjectsCount,
      memoryMB: `${this.getMemoryUsageMB()} MB`,
      uptimeSec: `${uptimeSec}s`,

      // Realtime Reliability Snapshot
      lastEventTimestamp: this.lastEventTimestamp,
      lastAcceptedSequence: { ...this.lastAcceptedSequence },
      lastDroppedEvent: this.lastDroppedEvent ? { ...this.lastDroppedEvent } : null,
      reconnectCount: this.reconnectCount,
      resyncCount: this.resyncCount,
      resyncFailureCount: this.resyncFailureCount,
      heartbeatLatencyMs: this.heartbeatLatencyMs,
      staleDurationMs: this.staleDurationMs,
      pendingCommandCount: this.pendingCommandCount,
      duplicateEventCount: this.duplicateEventCount
    };
  }

  captureSnapshot(context = {}) {
    return {
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),
      metrics: this.getMetricsReport(),
      recentEvents: this.getRecentEvents(15),
      context: sanitizeDiagnosticData(context)
    };
  }

  getMetrics() {
    return this.getMetricsReport();
  }

  resetAllTimers() {
    this.activeTimers.forEach(id => {
      clearInterval(id);
      clearTimeout(id);
    });
    this.activeTimers.clear();

    this.activeAnimationFrames.forEach(id => {
      cancelAnimationFrame(id);
    });
    this.activeAnimationFrames.clear();
  }

  reset() {
    this.stopLongTaskObserver();
    this.resetAllTimers();
    this.initCount = 0;
    this.activeSocketListenersCount = 0;
    this.domUpdateCount = 0;
    this.stateUpdateCount = 0;
    this.cctvDroppedFrames = 0;
    this.apiRequestCount = 0;
    this.apiErrorCount = 0;
    this.lastRenderDuration = 0;
    this.jankCount = 0;
    this.maxFrameTimeMs = 0;
    this.longTaskCount = 0;
    this.maxLongTaskDurationMs = 0;
    this.renderTimes = [];
    this.activeMapLayersCount = 0;
    this.trackedCctvObjectsCount = 0;
  }
}

export const diagnostics = new DiagnosticsManager();

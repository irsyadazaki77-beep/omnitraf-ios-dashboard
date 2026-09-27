/**
 * OmniTRAF Surabaya - Internal Runtime Diagnostics & Reliability Registry (Phase 18 Hardened)
 * Telemetry tracker for performance, realtime ordering, connection health & lifecycle metrics:
 * - lastEventTimestamp, lastAcceptedSequence per domain, lastDroppedEvent
 * - reconnectCount, resyncCount, resyncFailureCount, heartbeatLatencyMs, staleDurationMs
 * - cctvDroppedFrames, pendingCommandCount, duplicateEventCount
 * - initCount, activeTimers, activeSocketListeners, activeAnimationFrames
 */

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

    // Attach to window for debug / terminal access
    if (typeof window !== 'undefined') {
      window.__omnitrafDiagnostics = this;
    }
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

  recordRenderDuration(durationMs) {
    this.lastRenderDuration = Number(durationMs.toFixed(2));
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
      cctvDroppedFrames: this.cctvDroppedFrames,
      apiRequestCount: this.apiRequestCount,
      apiErrorCount: this.apiErrorCount,
      lastRenderDurationMs: `${this.lastRenderDuration}ms`,
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
}

export const diagnostics = new DiagnosticsManager();

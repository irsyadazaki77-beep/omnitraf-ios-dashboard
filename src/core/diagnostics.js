/**
 * OmniTRAF Surabaya - Internal Runtime Diagnostics & Disposer Registry (Phase 8)
 * Lightweight telemetry tracker for performance metrics:
 * - initCount, activeTimers, activeSocketListeners, activeAnimationFrames
 * - domUpdateCount, cctvDroppedFrames, apiRequestCount, apiErrorCount
 * - lastRenderDuration, memory indicators
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
      uptimeSec: `${uptimeSec}s`
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

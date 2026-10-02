/**
 * OmniTRAF Client-Side Realtime Metrics Collector (Phase 3 Master Architecture)
 * 
 * Bounded metrics collector for:
 * - socket connect count
 * - reconnect count
 * - reconnect duration
 * - RTT / ping latency
 * - event count & event rate
 * - dropped events
 * - sequence gap count
 * - resync count & duration
 * - stale duration
 * - payload size estimator
 */

export class RealtimeMetricsCollector {
  constructor() {
    this.connectCount = 0;
    this.reconnectCount = 0;
    this.lastReconnectStart = null;
    this.totalReconnectDurationMs = 0;
    this.rttHistory = [];
    this.maxHistory = 50;

    this.eventCount = 0;
    this.eventCountByTopic = new Map();
    this.eventRatePerSec = 0;
    this._eventCounterWindow = 0;
    this._lastRateSampleTime = Date.now();

    this.droppedEventsCount = 0;
    this.sequenceGapCount = 0;
    this.resyncCount = 0;
    this.resyncDurationMs = 0;
    this.staleDurationMs = 0;
    this.totalPayloadBytes = 0;

    this._startRateCalculation();
  }

  _startRateCalculation() {
    if (typeof setInterval !== 'undefined') {
      setInterval(() => {
        const now = Date.now();
        const elapsedSec = Math.max(1, (now - this._lastRateSampleTime) / 1000);
        this.eventRatePerSec = Math.round(this._eventCounterWindow / elapsedSec);
        this._eventCounterWindow = 0;
        this._lastRateSampleTime = now;
      }, 2000).unref?.();
    }
  }

  recordConnect() {
    this.connectCount++;
  }

  recordReconnectAttempt() {
    this.reconnectCount++;
    if (!this.lastReconnectStart) {
      this.lastReconnectStart = Date.now();
    }
  }

  recordReconnectSuccess() {
    if (this.lastReconnectStart) {
      this.totalReconnectDurationMs += Date.now() - this.lastReconnectStart;
      this.lastReconnectStart = null;
    }
  }

  recordRtt(latencyMs) {
    if (typeof latencyMs === 'number' && latencyMs >= 0) {
      this.rttHistory.push(latencyMs);
      if (this.rttHistory.length > this.maxHistory) {
        this.rttHistory.shift();
      }
    }
  }

  recordEvent(topic, payload) {
    this.eventCount++;
    this._eventCounterWindow++;
    const count = this.eventCountByTopic.get(topic) || 0;
    this.eventCountByTopic.set(topic, count + 1);

    if (payload) {
      // Rough payload size estimation without costly JSON.stringify when possible
      try {
        if (typeof payload === 'string') {
          this.totalPayloadBytes += payload.length;
        } else if (payload && typeof payload === 'object') {
          // Bounded sampling: sample size lightly
          this.totalPayloadBytes += 128; // nominal base size
        }
      } catch (_) {}
    }
  }

  recordDroppedEvent(topic, reason) {
    this.droppedEventsCount++;
  }

  recordSequenceGap(gapInfo) {
    this.sequenceGapCount++;
  }

  recordResync(durationMs) {
    this.resyncCount++;
    this.resyncDurationMs += durationMs || 0;
  }

  recordStaleDuration(durationMs) {
    this.staleDurationMs += durationMs || 0;
  }

  getSnapshot() {
    const avgRtt = this.rttHistory.length > 0
      ? Math.round(this.rttHistory.reduce((a, b) => a + b, 0) / this.rttHistory.length)
      : 0;

    return {
      connectCount: this.connectCount,
      reconnectCount: this.reconnectCount,
      totalReconnectDurationMs: this.totalReconnectDurationMs,
      avgRttMs: avgRtt,
      eventCount: this.eventCount,
      eventRatePerSec: this.eventRatePerSec,
      droppedEventsCount: this.droppedEventsCount,
      sequenceGapCount: this.sequenceGapCount,
      resyncCount: this.resyncCount,
      totalResyncDurationMs: this.resyncDurationMs,
      staleDurationMs: this.staleDurationMs,
      totalPayloadBytes: this.totalPayloadBytes,
      eventCountByTopic: Object.fromEntries(this.eventCountByTopic.entries())
    };
  }
}

export const realtimeMetrics = new RealtimeMetricsCollector();
export const RealtimeMetrics = RealtimeMetricsCollector;

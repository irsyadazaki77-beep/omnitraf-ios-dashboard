/**
 * OmniTRAF Client Resync & Gap Recovery Manager (Phase 3 Master Architecture)
 * 
 * Responsibilities:
 * - Single-flight idempotent state resynchronization
 * - Sequence gap detection & recovery orchestration
 * - In-flight event buffering during resynchronization
 * - Atomic snapshot application: applies canonical snapshot before buffered events
 * - HTTP REST fallback snapshot recovery when socket is degraded or times out
 */

import {
  stateStore,
  applyServerSnapshot,
  setConnectionLifecycle,
  updateTrafficState,
  updateCctvVisionState,
  updateIncidentState,
  updateEmergencyState,
  updateSignalState,
  updateDeviceState
} from './stateStore.js';
import { realtimeMetrics } from './realtimeMetrics.js';

export class ResyncManager {
  constructor(socketClient) {
    this.socketClient = socketClient;
    this.isResyncing = false;
    this._resyncPromise = null;
    this._resyncBuffer = [];
    this.maxBufferSize = 200; // Bound queue to prevent memory leak
  }

  setSocketClient(client) {
    this.socketClient = client;
  }

  /**
   * Buffer an incoming event while resyncing is underway
   */
  bufferEvent(topic, payload, applyFn) {
    if (this._resyncBuffer.length >= this.maxBufferSize) {
      // Latest-value-wins / bounded strategy: remove oldest to prevent unbounded growth
      this._resyncBuffer.shift();
      realtimeMetrics.recordDroppedEvent(topic, 'resync_buffer_overflow');
    }
    this._resyncBuffer.push({ topic, payload, applyFn, fn: applyFn });
  }

  /**
   * Single-Flight, Bounded Timeout, Idempotent Resynchronization
   */
  requestResync() {
    if (this._resyncPromise) {
      return this._resyncPromise;
    }

    const startTime = Date.now();
    this.isResyncing = true;
    setConnectionLifecycle('resyncing', { isStaleData: false });

    this._resyncPromise = (async () => {
      try {
        const socket = this.socketClient?.socket;
        const isConnected = !!(socket && socket.connected);

        if (isConnected) {
          const res = await new Promise((resolve) => {
            const timer = setTimeout(() => {
              resolve({ success: false, status: 'TIMEOUT', error: 'Socket resync timed out' });
            }, 4000);

            try {
              socket.emit('state:resync', {}, (response) => {
                clearTimeout(timer);
                resolve(response || { success: false, status: 'TIMEOUT' });
              });
            } catch (err) {
              clearTimeout(timer);
              resolve({ success: false, status: 'SERVER_UNAVAILABLE', error: err.message });
            }
          });

          if (res && res.success && (res.state || res.data)) {
            // Apply snapshot atomically
            applyServerSnapshot(res.state || res.data, 'server');
            this._flushResyncBuffer();
            setConnectionLifecycle('connected', {
              isStaleData: false,
              lastTelemetryAt: Date.now()
            });
            realtimeMetrics.recordResync(Date.now() - startTime);
            return { status: 'SUCCESS', source: 'socket', snapshot: res };
          }
        }

        // REST Snapshot Fallback
        try {
          const res = await fetch('/api/state/snapshot', { cache: 'no-store' });
          if (res.ok) {
            const json = await res.json();
            const payload = json.data || json.state || json;
            if (payload && (payload.intersections || payload.telemetry || payload.seq !== undefined)) {
              applyServerSnapshot(json, 'server');
              this._flushResyncBuffer();
              setConnectionLifecycle('connected', {
                isStaleData: false,
                lastTelemetryAt: Date.now()
              });
              realtimeMetrics.recordResync(Date.now() - startTime);
              return { status: 'SUCCESS', source: 'rest', snapshot: json };
            }
            return { status: 'INVALID_SNAPSHOT', source: 'rest', error: 'Malformed snapshot payload' };
          } else {
            return { status: 'SERVER_UNAVAILABLE', source: 'rest', httpStatus: res.status };
          }
        } catch (restErr) {
          return { status: 'SERVER_UNAVAILABLE', source: 'rest', error: restErr.message };
        }
      } catch (err) {
        console.warn("[ResyncManager] Resync attempt warning:", err);
        return { status: 'TIMEOUT', error: err.message };
      } finally {
        this.isResyncing = false;
        this._resyncPromise = null;
      }
    })();

    return this._resyncPromise;
  }

  _flushResyncBuffer() {
    if (!this._resyncBuffer || this._resyncBuffer.length === 0) return;
    const buffer = [...this._resyncBuffer];
    this._resyncBuffer = [];
    const currentState = stateStore.getState();

    const seqPropMap = {
      'traffic': 'lastReceivedSequence',
      'cctv': 'lastReceivedCctvSequence',
      'incident': 'lastReceivedIncidentSequence',
      'emergency': 'lastReceivedEmergencySequence',
      'signal': 'lastReceivedSignalSequence',
      'device': 'lastReceivedDeviceSequence'
    };

    buffer.forEach(({ topic, payload, applyFn, fn }) => {
      const seq = payload?.seq || payload?.sequence || 0;
      const prop = seqPropMap[topic] || 'lastReceivedSequence';
      const baselineSeq = currentState[prop] || 0;

      // Only apply if strictly newer than authoritative snapshot
      if (seq > baselineSeq) {
        try {
          const handler = applyFn || fn;
          if (typeof handler === 'function') {
            handler();
          }
        } catch (e) {
          console.warn(`[ResyncManager] Error applying buffered event for ${topic}:`, e);
        }
      }
    });
  }
}

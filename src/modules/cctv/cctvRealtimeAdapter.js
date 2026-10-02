/**
 * OmniTRAF Surabaya - CCTV Realtime Adapter (Phase 7 Architecture)
 * Mengisolasi koneksi transport Socket.io dari business state dan DOM:
 * - Subscriptions ke channel kamera tersegregasi (`room:cctv:all` & `room:cctv:{camId}`)
 * - Reconnect resync & room renewal
 * - Guard backpressure (frame age > 3000ms & out-of-order sequence detection)
 * - Deterministic fallback generator jika disconnected/offline
 */

import { socketClient } from '../../core/socketClient.js';
import { stateStore } from '../../core/stateStore.js';
import { REALTIME_ROOMS } from '../../../shared/realtimeRooms.js';
import { SeededRandom } from '../../../shared/seededRandom.js';

export class CctvRealtimeAdapter {
  constructor(options = {}) {
    this.localFallbackRandom = options.randomStream || new SeededRandom('omnitraf-cctv-local-fallback');
    this.onFrameCallback = options.onFrame || (() => {});
    this.lastProcessedSeq = 0;
    this.latestPayload = null;
    this.lastReceivedTime = Date.now();
    this._socketUnsubscribe = null;
    this._localFallbackTimer = null;
    this._subscribedRooms = new Set();
  }

  /**
   * Mulai listening ke event CCTV dari socketClient
   * @param {Object} disposer Disposer instance untuk clean cleanup
   * @param {Map} camerasRegistry Registry kamera untuk fallback generator
   */
  connect(disposer, camerasRegistry) {
    this.disconnect();

    // Listen to aggregate CCTV stream
    this._socketUnsubscribe = disposer.addSocketListener(socketClient, 'cctv:vision-update', (framePayload) => {
      this.handleIncomingPayload(framePayload, 'server');
    });

    // Also listen to fine-grained camera detection stream
    disposer.addSocketListener(socketClient, 'cctv:camera:detection', (camPayload) => {
      if (camPayload && camPayload.cameraId) {
        const wrapped = {
          seq: camPayload.sequence || 0,
          timestamp: camPayload.timestamp || Date.now(),
          source: 'server',
          cameras: {
            [camPayload.cameraId]: camPayload
          }
        };
        this.handleIncomingPayload(wrapped, 'server');
      }
    });

    // Start local fallback simulation generator for offline demonstration
    this._startLocalFallback(disposer, camerasRegistry);
  }

  /**
   * Subscribe ke room kamera spesifik di socket server
   * @param {string} camId ID kamera
   */
  subscribeCamera(camId) {
    if (!camId) return;
    const room = REALTIME_ROOMS.cctvCamera(camId);
    if (!this._subscribedRooms.has(room)) {
      this._subscribedRooms.add(room);
      const socket = socketClient.getSocket();
      if (socket && socket.connected) {
        socket.emit('channel:subscribe', { channels: [room] });
      }
    }
  }

  /**
   * Unsubscribe dari room kamera spesifik
   * @param {string} camId ID kamera
   */
  unsubscribeCamera(camId) {
    if (!camId) return;
    const room = REALTIME_ROOMS.cctvCamera(camId);
    if (this._subscribedRooms.has(room)) {
      this._subscribedRooms.delete(room);
      const socket = socketClient.getSocket();
      if (socket && socket.connected) {
        socket.emit('channel:unsubscribe', { channels: [room] });
      }
    }
  }

  /**
   * Validasi sequence, backpressure, dan stale frame rejection
   */
  handleIncomingPayload(framePayload, source = 'server') {
    if (!framePayload) return false;

    const incomingSeq = Number(framePayload.seq) || 0;
    const timestamp = Number(framePayload.timestamp) || Date.now();

    // 1. Out-of-order rejection guard
    if (incomingSeq > 0 && incomingSeq < this.lastProcessedSeq) {
      return false;
    }

    // 2. Stale network frame backlog guard (> 3000ms old)
    const frameAge = Date.now() - timestamp;
    if (frameAge > 3000) {
      return false;
    }

    this.lastProcessedSeq = incomingSeq;
    this.latestPayload = framePayload;
    this.lastReceivedTime = Date.now();

    this.onFrameCallback(framePayload, source);
    return true;
  }

  _startLocalFallback(disposer, camerasRegistry) {
    this.localFallbackRandom.reset('omnitraf-cctv-local-fallback');
    const currentState = stateStore.getState();
    this.localFallbackTimeMs = Number(currentState.timestampMs || currentState.telemetry?.timestampMs) || Date.now();
    const localVehicles = new Map();
    camerasRegistry.forEach((val, id) => {
      localVehicles.set(id, [
        { id: `${id}-v0`, lane: 0, progress: 0.15, class: 'ambulance', speed: 0.012, conf: 98 },
        { id: `${id}-v1`, lane: 1, progress: 0.45, class: 'car', speed: 0.009, conf: 95 },
        { id: `${id}-v2`, lane: 2, progress: 0.70, class: 'bus', speed: 0.007, conf: 94 },
        { id: `${id}-v3`, lane: 3, progress: 0.85, class: 'motorcycle', speed: 0.011, conf: 92 }
      ]);
    });

    disposer.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;

      const connStatus = stateStore.getState().connectionStatus;
      // Do not run local fallback if online and connected
      if (connStatus === 'connected' || connStatus === 'resyncing') {
        return;
      }

      const isChaos = stateStore.getState().isChaosMode;
      this.localFallbackTimeMs += 300;
      const timestamp = this.localFallbackTimeMs;
      this.lastProcessedSeq++;

      const camerasData = {};

      camerasRegistry.forEach((val, camId) => {
        const vehicles = localVehicles.get(camId) || [];
        const detections = [];

        vehicles.forEach(v => {
          v.progress += isChaos ? v.speed * 0.3 : v.speed;
          if (v.progress > 1.0) {
            v.progress = 0;
            v.lane = this.localFallbackRandom.rangeInt(0, 3);
          }
          const t = v.progress;
          const vx = 0.5, vy = 0.28;
          const laneEnds = [0.12, 0.36, 0.64, 0.88];
          const bx = laneEnds[v.lane];
          const x = vx + (bx - vx) * t;
          const y = vy + (1.0 - vy) * t;
          const scale = 0.2 + t * 0.8;
          
          let baseW = 0.12, baseH = 0.09;
          if (v.class === 'bus') { baseW = 0.16; baseH = 0.12; }
          else if (v.class === 'ambulance') { baseW = 0.14; baseH = 0.10; }

          const w = baseW * scale;
          const h = baseH * scale;

          detections.push({
            id: v.id,
            trackId: v.id,
            class: v.class,
            confidence: v.conf,
            x: Math.max(0.01, Math.min(0.95, x - w / 2)),
            y: Math.max(0.01, Math.min(0.95, y - h / 2)),
            w,
            h,
            speedKmh: Math.round((isChaos ? 12 : 45) + this.localFallbackRandom.range(0, 4))
          });
        });

        camerasData[camId] = {
          cameraId: camId,
          timestamp,
          sequence: this.lastProcessedSeq,
          fps: isChaos ? 18 : 30,
          resolution: '1920x1080',
          source: 'Local Simulation Fallback',
          processingLatencyMs: isChaos ? 28 : 5,
          streamStatus: isChaos ? 'DEGRADED' : 'ONLINE',
          detections
        };
      });

      const fallbackPayload = {
        seq: this.lastProcessedSeq,
        timestamp,
        source: 'local',
        cameras: camerasData
      };

      this.handleIncomingPayload(fallbackPayload, 'local');
    }, 300);
  }

  disconnect() {
    if (this._socketUnsubscribe && typeof this._socketUnsubscribe === 'function') {
      this._socketUnsubscribe();
      this._socketUnsubscribe = null;
    }
    this._subscribedRooms.clear();
  }
}

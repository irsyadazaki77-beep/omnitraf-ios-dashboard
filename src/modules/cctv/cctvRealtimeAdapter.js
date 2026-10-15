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
import { diagnostics } from '../../core/diagnostics.js';
import { REALTIME_ROOMS } from '../../../shared/realtimeRooms.js';
import { TrafficVehicleSimulation, projectTrafficVehicle, trafficCameraConfig } from '../../../shared/trafficVehicleSimulation.js';

export class CctvRealtimeAdapter {
  constructor(options = {}) {
    this.localVehicleSimulation = options.vehicleSimulation || new TrafficVehicleSimulation({ seed: 42 });
    this.onFrameCallback = options.onFrame || (() => {});
    this.coalesceVisualUpdates = options.coalesceVisualUpdates === true;
    this.lastProcessedSeq = 0;
    this.latestPayload = null;
    this.lastReceivedTime = Date.now();
    this._socketUnsubscribe = null;
    this._localFallbackTimer = null;
    this._subscribedRooms = new Set();
    this._visualFrameHandle = null;
    this._pendingVisualFrame = null;
    this.coalescedVisualUpdates = 0;
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

    // The CCTV view renders all four cameras in grid mode. Subscribe to the
    // canonical aggregate room so it receives the same server frame as City3D,
    // even before a user explicitly focuses an individual camera.
    this._subscribedRooms.add(REALTIME_ROOMS.CCTV_ALL);
    socketClient.subscribeChannels?.([REALTIME_ROOMS.CCTV_ALL]);

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
      socketClient.subscribeChannels?.([room]);
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
      socketClient.unsubscribeChannels?.([room]);
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

    this._queueVisualFrame(framePayload, source);
    return true;
  }

  _queueVisualFrame(framePayload, source) {
    if (!this.coalesceVisualUpdates) {
      this.onFrameCallback(framePayload, source);
      return;
    }
    if (this._pendingVisualFrame) {
      this.coalescedVisualUpdates++;
      diagnostics.recordDroppedFrame();
      diagnostics.recordCoalescedDomUpdate();
    }
    this._pendingVisualFrame = { framePayload, source };
    if (this._visualFrameHandle !== null) return;
    const flush = () => {
      this._visualFrameHandle = null;
      const latest = this._pendingVisualFrame;
      this._pendingVisualFrame = null;
      if (latest) this.onFrameCallback(latest.framePayload, latest.source);
    };
    if (typeof requestAnimationFrame === 'function') this._visualFrameHandle = requestAnimationFrame(flush);
    else flush();
  }

  _startLocalFallback(disposer, camerasRegistry) {
    const currentState = stateStore.getState();
    this.localFallbackTimeMs = Number(currentState.timestampMs || currentState.telemetry?.timestampMs) || Date.now();

    disposer.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;

      const connStatus = stateStore.getState().connectionStatus;
      // Do not run local fallback if online and connected
      if (connStatus === 'connected' || connStatus === 'resyncing') {
        return;
      }

      const simulationState = stateStore.getState();
      const isChaos = simulationState.isChaosMode;
      this.localFallbackTimeMs += 300;
      const timestamp = this.localFallbackTimeMs;
      this.lastProcessedSeq++;
      this.localVehicleSimulation.step(simulationState, .3);

      const camerasData = {};

      camerasRegistry.forEach((val, camId) => {
        const config = trafficCameraConfig(camId);
        if (!config) return;
        const corridor = simulationState.trafficModel?.corridors?.find(item => item.corridorId === config.corridorId);
        const node = simulationState.intersections?.find(item => item.id === config.nodeId);
        const detections = this.localVehicleSimulation.getVehicles(camId).map(vehicle => {
          const position = projectTrafficVehicle(vehicle, config.scene);
          const scale = Math.max(.38, Math.min(1.25, position.depth));
          const sizes = { car: [.105, .075], bus: [.145, .105], truck: [.14, .10], motorcycle: [.058, .068], ambulance: [.12, .082] };
          const [baseW, baseH] = sizes[vehicle.type] || sizes.car;
          return {
            id: vehicle.id, trackId: vehicle.id, class: vehicle.type, confidence: vehicle.confidence,
            x: Math.max(.002, Math.min(.998 - baseW * scale, position.x - baseW * scale / 2)),
            y: Math.max(.002, Math.min(.998 - baseH * scale, position.y - baseH * scale / 2)),
            w: baseW * scale, h: baseH * scale,
            speedKmh: Math.round(vehicle.speedKmh), accelerationMps2: vehicle.acceleration,
            lane: vehicle.lane, direction: vehicle.direction, progress: Number(vehicle.progress.toFixed(4)),
            movement: vehicle.movement, braking: vehicle.braking, stopped: vehicle.stopped,
            signalState: node?.state || (config.scene === 'roundabout' ? 'yield' : 'none'), provenance: 'SIMULATED'
          };
        });

        camerasData[camId] = {
          cameraId: camId,
          timestamp,
          sequence: this.lastProcessedSeq,
          fps: isChaos ? 18 : 30,
          source: 'OmniTRAF local traffic simulation',
          provenance: 'SIMULATED',
          processingLatencyMs: isChaos ? 28 : 5,
          streamStatus: isChaos ? 'DEGRADED' : 'ONLINE',
          scene: config.scene,
          intersectionId: config.nodeId,
          signalState: node?.state || (config.scene === 'roundabout' ? 'yield' : 'none'),
          trafficMetrics: corridor ? { ...corridor, provenance: 'SIMULATED' } : {
            scope: 'network-average', speedKmh: simulationState.trafficModel?.averageSpeedKmh ?? null,
            queueVehicles: simulationState.trafficModel?.queueVehicles ?? null,
            congestionIndex: simulationState.trafficModel?.congestionIndex ?? null, provenance: 'SIMULATED'
          },
          detections
        };
      });

      const fallbackPayload = {
        seq: this.lastProcessedSeq,
        timestamp,
        source: 'local',
        provenance: 'SIMULATED',
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
    if (this._visualFrameHandle !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._visualFrameHandle);
    this._visualFrameHandle = null;
    this._pendingVisualFrame = null;
    socketClient.unsubscribeChannels?.([...this._subscribedRooms]);
    this._subscribedRooms.clear();
  }
}

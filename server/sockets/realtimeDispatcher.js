/**
 * OmniTRAF Realtime Event Dispatcher (Phase 3 Master Architecture)
 * 
 * Abstraction layer between Domain Business Logic and Socket.io Rooms.
 * Responsibilities:
 * - Domain event routing to specific rooms (targeted rooms)
 * - Broadcast amplification reduction (only send to subscribers)
 * - Backward compatibility bridge (ensures global legacy listeners still receive data if needed)
 * - Error isolation: if a room or payload serialization fails, other channels continue uninterrupted.
 * - Redis Adapter multi-instance compatibility: uses io.to(room).emit() which natively works with @socket.io/redis-adapter
 */

import { REALTIME_ROOMS, REALTIME_PRIORITIES, REALTIME_EVENTS } from './eventRegistry.js';

export class RealtimeEventDispatcher {
  constructor(io = null, backwardCompatibilityMode = true) {
    this.io = io;
    this.backwardCompatibilityMode = backwardCompatibilityMode;
    this.metrics = {
      dispatchedCount: 0,
      roomDispatches: new Map(),
      errorsCaught: 0,
      lastDispatchAt: null
    };
  }

  setIo(io) {
    this.io = io;
  }

  /**
   * Safe emission helper with domain error boundary
   * @param {string|string[]} targetRooms Room or array of rooms. If null, emits globally.
   * @param {string} event Event name
   * @param {*} payload Serializable payload
   * @param {string} priority Priority tier (CRITICAL, HIGH, NORMAL, HF_VISUAL)
   */
  dispatch(targetRooms, event, payload, priority = REALTIME_PRIORITIES.NORMAL) {
    if (!this.io) return false;

    try {
      this.metrics.dispatchedCount++;
      this.metrics.lastDispatchAt = Date.now();

      // Normalize rooms
      let rooms = [];
      if (typeof targetRooms === 'string') {
        rooms = [targetRooms];
      } else if (Array.isArray(targetRooms)) {
        rooms = targetRooms.filter(Boolean);
      }

      if (rooms.length === 0) {
        // Global broadcast
        this.io.emit(event, payload);
        this._recordRoomMetric('global');
      } else {
        // Emit to targeted rooms individually so multi-room broadcasts work reliably
        for (const room of rooms) {
          try {
            this.io.to(room).emit(event, payload);
            this._recordRoomMetric(room);
          } catch (roomErr) {
            this.metrics.errorsCaught++;
            console.error(`❌ [RealtimeDispatcher] Gagal mendistribusikan ke room '${room}':`, roomErr);
          }
        }

        // Backward compatibility bridge: for legacy clients not subscribed to rooms
        const roomRestrictedEvents = new Set([
          REALTIME_EVENTS.AUDIT_LOG,
          REALTIME_EVENTS.CCTV_VISION_UPDATE,
          REALTIME_EVENTS.CCTV_CAMERA_DETECTION,
          REALTIME_EVENTS.CCTV_CAMERA_HEALTH,
          REALTIME_EVENTS.CHAOS_FAULT_INJECTED
        ]);
        if (this.backwardCompatibilityMode && !roomRestrictedEvents.has(event) && typeof this.io.emit === 'function') {
          try {
            this.io.emit(event, payload);
            this._recordRoomMetric('global_compat');
          } catch (compatErr) {
            this.metrics.errorsCaught++;
          }
        }
      }

      return true;
    } catch (err) {
      this.metrics.errorsCaught++;
      console.error(`❌ [RealtimeDispatcher] Gagal mendistribusikan event '${event}' ke [${targetRooms}]:`, err);
      return false;
    }
  }

  _recordRoomMetric(room) {
    const curr = this.metrics.roomDispatches.get(room) || 0;
    this.metrics.roomDispatches.set(room, curr + 1);
  }

  // ==========================================
  // DOMAIN-SPECIFIC TYPED DISPATCHERS
  // ==========================================

  /**
   * Telemetry updates (dispatched to dashboard and traffic rooms, or globally for compatibility)
   */
  dispatchTrafficUpdate(statePayload) {
    return this.dispatch(
      [REALTIME_ROOMS.DASHBOARD, REALTIME_ROOMS.TRAFFIC],
      REALTIME_EVENTS.TRAFFIC_UPDATE,
      statePayload,
      REALTIME_PRIORITIES.NORMAL
    );
  }

  /**
   * Signal APILL updates
   */
  dispatchSignalUpdate(signalPayload) {
    return this.dispatch(
      [REALTIME_ROOMS.SIGNALS, REALTIME_ROOMS.DASHBOARD, REALTIME_ROOMS.TRAFFIC],
      REALTIME_EVENTS.SIGNAL_UPDATE,
      signalPayload,
      REALTIME_PRIORITIES.HIGH
    );
  }

  /**
   * Emergency Priority 112 updates
   */
  dispatchEmergencyUpdate(emergencyPayload) {
    return this.dispatch(
      [REALTIME_ROOMS.EMERGENCY, REALTIME_ROOMS.DASHBOARD, REALTIME_ROOMS.TRAFFIC],
      REALTIME_EVENTS.EMERGENCY_UPDATE,
      emergencyPayload,
      REALTIME_PRIORITIES.CRITICAL
    );
  }

  dispatchEmergencyAlert(alertPayload) {
    return this.dispatch(
      [REALTIME_ROOMS.EMERGENCY, REALTIME_ROOMS.DASHBOARD],
      REALTIME_EVENTS.EMERGENCY_DISPATCH_ALERT,
      alertPayload,
      REALTIME_PRIORITIES.CRITICAL
    );
  }

  /**
   * Incident updates & resolutions
   */
  dispatchIncidentUpdate(incidentPayload) {
    return this.dispatch(
      [REALTIME_ROOMS.INCIDENTS, REALTIME_ROOMS.DASHBOARD],
      REALTIME_EVENTS.INCIDENT_UPDATE,
      incidentPayload,
      REALTIME_PRIORITIES.HIGH
    );
  }

  dispatchIncidentResolved(resolvedPayload) {
    return this.dispatch(
      [REALTIME_ROOMS.INCIDENTS, REALTIME_ROOMS.DASHBOARD],
      REALTIME_EVENTS.INCIDENT_RESOLVED,
      resolvedPayload,
      REALTIME_PRIORITIES.HIGH
    );
  }

  /**
   * IoT Device updates
   */
  dispatchDeviceUpdate(devicePayload) {
    return this.dispatch(
      [REALTIME_ROOMS.DEVICES, REALTIME_ROOMS.DASHBOARD],
      REALTIME_EVENTS.DEVICE_UPDATE,
      devicePayload,
      REALTIME_PRIORITIES.HIGH
    );
  }

  dispatchDeviceConfigTransition(transitionPayload) {
    return this.dispatch(
      [REALTIME_ROOMS.DEVICES],
      REALTIME_EVENTS.DEVICE_CONFIG_TRANSITION,
      transitionPayload,
      REALTIME_PRIORITIES.HIGH
    );
  }

  /**
   * Command Acknowledgements & Audit Logs
   */
  dispatchCommandAck(ackPayload) {
    return this.dispatch(
      null, // Broadcast globally to all authenticated sessions so multi-tab / command center views sync
      REALTIME_EVENTS.COMMAND_ACK,
      ackPayload,
      REALTIME_PRIORITIES.CRITICAL
    );
  }

  dispatchAuditLog(auditPayload) {
    return this.dispatch(
      [REALTIME_ROOMS.AUDIT],
      REALTIME_EVENTS.AUDIT_LOG,
      auditPayload,
      REALTIME_PRIORITIES.NORMAL
    );
  }

  dispatchSystemToast(toastPayload) {
    return this.dispatch(
      null, // Toasts are meant for all active users
      REALTIME_EVENTS.SYSTEM_TOAST,
      toastPayload,
      REALTIME_PRIORITIES.NORMAL
    );
  }

  dispatchChaosFaultInjected(faultPayload) {
    return this.dispatch(
      [REALTIME_ROOMS.ADMIN],
      REALTIME_EVENTS.CHAOS_FAULT_INJECTED,
      faultPayload,
      REALTIME_PRIORITIES.CRITICAL
    );
  }

  /**
   * High-Frequency Computer Vision Stream
   * Segregated into:
   * 1. Aggregate stream (room:cctv:all)
   * 2. Per-camera channels (room:cctv:camId) with separated detection and health metadata
   */
  dispatchCctvVision(visionPayload) {
    if (!this.io) return false;

    try {
      // 1. Dispatch aggregate stream to clients subscribed to CCTV
      this.dispatch(
        REALTIME_ROOMS.CCTV_ALL,
        REALTIME_EVENTS.CCTV_VISION_UPDATE,
        visionPayload,
        REALTIME_PRIORITIES.HIGH_FREQUENCY_VISUAL
      );

      // 2. Fine-grained stream per camera (Langkah 5: CCTV Stream Separation)
      const cameras = visionPayload.cameras || visionPayload.cameraDetections || {};
      for (const [camId, camData] of Object.entries(cameras)) {
        const camRoom = REALTIME_ROOMS.cctvCamera(camId);
        const detections = Array.isArray(camData) ? camData : (camData?.detections || []);

        // Separated detection stream
        this.dispatch(
          camRoom,
          REALTIME_EVENTS.CCTV_CAMERA_DETECTION,
          {
            cameraId: camId,
            seq: visionPayload.seq,
            timestamp: visionPayload.timestamp,
            detections
          },
          REALTIME_PRIORITIES.HIGH_FREQUENCY_VISUAL
        );

        // Separated health & performance metadata stream
        this.dispatch(
          camRoom,
          REALTIME_EVENTS.CCTV_CAMERA_HEALTH,
          {
            cameraId: camId,
            seq: visionPayload.seq,
            timestamp: visionPayload.timestamp,
            fps: camData.fps,
            resolution: camData.resolution,
            streamStatus: camData.streamStatus,
            processingLatencyMs: camData.processingLatencyMs
          },
          REALTIME_PRIORITIES.NORMAL
        );
      }

      return true;
    } catch (err) {
      this.metrics.errorsCaught++;
      console.error("❌ [RealtimeDispatcher] CCTV vision dispatch error:", err);
      return false;
    }
  }

  getMetrics() {
    return {
      dispatchedCount: this.metrics.dispatchedCount,
      errorsCaught: this.metrics.errorsCaught,
      lastDispatchAt: this.metrics.lastDispatchAt,
      roomDispatches: Object.fromEntries(this.metrics.roomDispatches.entries())
    };
  }
}

export const realtimeDispatcher = new RealtimeEventDispatcher();

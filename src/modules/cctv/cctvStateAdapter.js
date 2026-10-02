/**
 * OmniTRAF Surabaya - CCTV State Adapter (Phase 7 Architecture)
 * Jembatan antara pipeline CCTV independen dengan global StateStore:
 * - Throttle state updates (1000ms) untuk mencegah render backlog
 * - Memetakan camera telemetry ke format stateStore.cctvCamerasMetrics
 * - Isolasi update jika terjadi error pada salah satu kamera
 */

import { stateStore } from '../../core/stateStore.js';

export class CctvStateAdapter {
  constructor(throttleMs = 1000) {
    this.throttleMs = throttleMs;
    this.lastSyncAt = 0;
  }

  /**
   * Sync frame payload dan metrics kamera ke StateStore dengan throttle rate
   * @param {Object} framePayload
   * @param {Map} camerasState
   * @param {string} source
   */
  syncToStore(framePayload, camerasState, source = 'server') {
    const now = Date.now();
    if (now - this.lastSyncAt < this.throttleMs) {
      return false;
    }

    this.lastSyncAt = now;
    try {
      const metricsObj = Object.fromEntries(camerasState.entries());
      stateStore.setState({
        cctvVisionData: framePayload,
        cctvCamerasMetrics: metricsObj
      }, { source, emitGeneric: false });
      return true;
    } catch (err) {
      console.warn("⚠️ [CctvStateAdapter] Gagal menyinkronkan state CCTV ke store:", err);
      return false;
    }
  }

  forceSync(framePayload, camerasState, source = 'server') {
    this.lastSyncAt = Date.now();
    try {
      const metricsObj = Object.fromEntries(camerasState.entries());
      stateStore.setState({
        cctvVisionData: framePayload,
        cctvCamerasMetrics: metricsObj
      }, { source, emitGeneric: false });
      return true;
    } catch (err) {
      return false;
    }
  }
}

export const cctvStateAdapter = new CctvStateAdapter(1000);

/**
 * OmniTRAF Surabaya - CCTV Telemetry Service (Phase 1 & Phase 7 Compatible)
 * Bertanggung jawab khusus untuk metrics CCTV, FPS, latency,
 * health status (ONLINE, STALE, OFFLINE, DEGRADED), dan anomaly tracking.
 */

import { cameraRegistry } from './cameraRegistry.js';

export class CctvTelemetry {
  constructor() {
    this.camerasRegistry = new Map();
    // Maintain backward-compatible Map interface for camerasRegistry
    cameraRegistry.getAllMetadata().forEach(meta => {
      this.camerasRegistry.set(meta.id, { name: meta.name });
    });
  }

  get camerasState() {
    return cameraRegistry.getAllRuntimes();
  }

  getState(camId) {
    return cameraRegistry.getRuntime(camId);
  }

  getAllStates() {
    return cameraRegistry.getAllRuntimes();
  }
}

export const cctvTelemetry = new CctvTelemetry();

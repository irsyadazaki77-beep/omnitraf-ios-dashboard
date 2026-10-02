/**
 * OmniTRAF Surabaya - Camera Registry & Domain Models (Phase 7 Refactor)
 * Memisahkan CAMERA IDENTITY (metadata permanen) dari CAMERA RUNTIME STATE (status dinamis).
 */

export const CAMERA_DEFINITIONS = Object.freeze([
  {
    id: 'dashCameraCanvas',
    code: 'CAM-01',
    name: 'Simpang Wonokromo (Frontage A. Yani)',
    shortName: 'SIMPANG WONOKROMO',
    location: 'Jl. Wonokromo - Frontage Road A. Yani, Surabaya',
    nodeId: 'node-wonokromo',
    edgeDeviceId: 'NODE-EDGE-01',
    capabilities: Object.freeze(['detection', 'tracking', 'telemetry', 'snapshot']),
    defaultResolution: '1920x1080',
    defaultFps: 30
  },
  {
    id: 'cctvCanvas1',
    code: 'CAM-01',
    name: 'Simpang Wonokromo (Frontage A. Yani)',
    shortName: 'SIMPANG WONOKROMO',
    location: 'Jl. Wonokromo - Frontage Road A. Yani, Surabaya',
    nodeId: 'node-wonokromo',
    edgeDeviceId: 'NODE-EDGE-01',
    capabilities: Object.freeze(['detection', 'tracking', 'telemetry', 'snapshot']),
    defaultResolution: '1920x1080',
    defaultFps: 30
  },
  {
    id: 'cctvCanvas2',
    code: 'CAM-02',
    name: 'Koridor Raya Darmo',
    shortName: 'KORIDOR RAYA DARMO',
    location: 'Jl. Raya Darmo (Taman Bungkul), Surabaya',
    nodeId: 'node-darmo',
    edgeDeviceId: 'NODE-EDGE-02',
    capabilities: Object.freeze(['detection', 'tracking', 'telemetry', 'snapshot']),
    defaultResolution: '1920x1080',
    defaultFps: 30
  },
  {
    id: 'cctvCanvas3',
    code: 'CAM-03',
    name: 'Bundaran Waru (Gerbang Kota)',
    shortName: 'BUNDARAN WARU',
    location: 'Bundaran Waru - Gerbang Masuk Kota Surabaya',
    nodeId: 'node-wonokromo',
    edgeDeviceId: 'NODE-EDGE-03',
    capabilities: Object.freeze(['detection', 'tracking', 'telemetry', 'snapshot']),
    defaultResolution: '1920x1080',
    defaultFps: 30
  },
  {
    id: 'cctvCanvas4',
    code: 'CAM-04',
    name: 'Simpang Jemursari',
    shortName: 'SIMPANG JEMURSARI',
    location: 'Jl. Jemursari - Margorejo, Surabaya',
    nodeId: 'node-jemursari',
    edgeDeviceId: 'NODE-CTRL-01',
    capabilities: Object.freeze(['detection', 'tracking', 'telemetry', 'snapshot']),
    defaultResolution: '1920x1080',
    defaultFps: 30
  },
  {
    id: 'cctvZoomCanvas',
    code: 'CAM-ZOOM',
    name: 'Zoom Feed View',
    shortName: 'ZOOM VIEW',
    location: 'Area Terfokus SITS Surabaya',
    nodeId: 'node-wonokromo',
    edgeDeviceId: 'NODE-EDGE-01',
    capabilities: Object.freeze(['detection', 'tracking', 'telemetry', 'snapshot']),
    defaultResolution: '1920x1080',
    defaultFps: 30
  }
]);

export class CameraRegistry {
  constructor() {
    this._metadata = new Map();
    this._runtimes = new Map();

    CAMERA_DEFINITIONS.forEach(def => {
      this._metadata.set(def.id, Object.freeze({ ...def }));
      this._runtimes.set(def.id, this._createInitialRuntime(def.id));
    });
  }

  _createInitialRuntime(id) {
    const meta = this._metadata ? this._metadata.get(id) : null;
    const def = CAMERA_DEFINITIONS.find(d => d.id === id);
    const name = meta?.name || def?.name || id;

    return {
      id,
      name,
      status: 'ONLINE', // ONLINE, STALE, OFFLINE, DEGRADED
      provenance: 'SIMULATED', // LIVE, SIMULATED, STALE, OFFLINE
      lastFrameAt: Date.now(),
      lastProcessedSeq: 0,
      consecutiveFailures: 0,
      playbackState: 'PLAYING', // PLAYING, PAUSED
      metrics: {
        vehicleCount: 0,
        carCount: 0,
        motorcycleCount: 0,
        busCount: 0,
        truckCount: 0,
        ambulanceCount: 0,
        personCount: 0,
        laneOccupancy: 0,
        queueLengthMeters: 0,
        estimatedAverageSpeed: 42,
        trafficDensity: 0,
        incidentRisk: 0,
        aiConfidence: 96
      },
      diagnostics: {
        droppedFrameCount: 0,
        averageLatencyMs: 8,
        lastPacketAge: 0,
        activeTracks: 0,
        fps: 30
      },
      shortWindowHistory: []
    };
  }

  getMetadata(camId) {
    return this._metadata.get(camId) || null;
  }

  getAllMetadata() {
    return Array.from(this._metadata.values());
  }

  has(camId) {
    return this._metadata.has(camId);
  }

  getRuntime(camId) {
    return this._runtimes.get(camId) || null;
  }

  getAllRuntimes() {
    return this._runtimes;
  }

  resetRuntime(camId) {
    if (this._metadata.has(camId)) {
      this._runtimes.set(camId, this._createInitialRuntime(camId));
    }
  }

  resetAllRuntimes() {
    for (const id of this._metadata.keys()) {
      this.resetRuntime(id);
    }
  }
}

export const cameraRegistry = new CameraRegistry();

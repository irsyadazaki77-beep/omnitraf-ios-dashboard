import { systemClock } from './unifiedClock.js';
import { defaultRandomRegistry, SeededRandom } from './seededRandom.js';

export class ComputerVisionEngine {
  constructor(options = {}) {
    this.clock = options.clock || systemClock;
    this.randomRegistry = options.randomRegistry || defaultRandomRegistry;
    this.prng = options.randomStream || (this.randomRegistry ? this.randomRegistry.getStream('cctv') : new SeededRandom(42));
    this.frameSequence = 1;
    this.cameras = ['dashCameraCanvas', 'cctvCanvas1', 'cctvCanvas2', 'cctvCanvas3', 'cctvCanvas4'];
    this.classes = ['car', 'bus', 'truck', 'motorcycle', 'ambulance', 'person'];
    this.vehiclesPerCam = new Map();

    this.cameras.forEach(camId => {
      this.vehiclesPerCam.set(camId, this._generateInitialVehicles(camId));
    });
  }

  _generateInitialVehicles(camId) {
    const count = camId === 'dashCameraCanvas' ? 6 : 4;
    const vehicles = [];
    for (let i = 0; i < count; i++) {
      const cls = i === 0 ? (camId === 'dashCameraCanvas' ? 'ambulance' : 'bus') :
                  i % 3 === 0 ? 'truck' :
                  i % 2 === 0 ? 'motorcycle' : 'car';
      
      const lane = i % 4;
      vehicles.push({
        id: `${camId}-v${i}`,
        lane: lane,
        progress: (i / count) + this.prng.nextFloat() * 0.1,
        speed: 0.008 + this.prng.nextFloat() * 0.006,
        class: cls,
        confidence: Math.floor(91 + this.prng.nextFloat() * 8)
      });
    }
    return vehicles;
  }

  // Mutate simulated state separately to decouple generation from retrieval
  tickSimulation(isChaosMode) {
    this.cameras.forEach(camId => {
      const vehicles = this.vehiclesPerCam.get(camId) || [];
      vehicles.forEach(v => {
        const effSpeed = isChaosMode ? v.speed * 0.2 : v.speed;
        v.progress += effSpeed;
        if (v.progress > 1.0) {
          v.progress = 0;
          v.lane = Math.floor(this.prng.nextFloat() * 4);
          v.confidence = Math.floor(90 + this.prng.nextFloat() * 9);
        }
      });
    });
  }

  generateFramePayload(isChaosMode) {
    this.frameSequence++;
    const timestamp = this.clock.now();
    const camerasData = {};

    // First, step the simulation
    this.tickSimulation(isChaosMode);

    this.cameras.forEach(camId => {
      const vehicles = this.vehiclesPerCam.get(camId) || [];
      const detections = [];

      vehicles.forEach(v => {
        // Perspective Projection calculation (0..1 normalized space)
        const t = v.progress;
        const vx = 0.5; // Vanishing point X
        const vy = 0.28; // Vanishing point Y
        const laneEndpointsX = [0.12, 0.36, 0.64, 0.88];
        const bx = laneEndpointsX[v.lane];
        const by = 1.0;

        const xNorm = vx + (bx - vx) * t;
        const yNorm = vy + (by - vy) * t;

        const scale = 0.15 + t * 0.85;

        let baseW = 0.12, baseH = 0.09;
        if (v.class === 'bus') { baseW = 0.16; baseH = 0.12; }
        else if (v.class === 'truck') { baseW = 0.15; baseH = 0.11; }
        else if (v.class === 'ambulance') { baseW = 0.14; baseH = 0.10; }
        else if (v.class === 'motorcycle') { baseW = 0.07; baseH = 0.07; }
        else if (v.class === 'person') { baseW = 0.04; baseH = 0.08; }

        const wNorm = baseW * scale;
        const hNorm = baseH * scale;

        detections.push({
          id: v.id,
          trackId: v.id,
          class: v.class,
          confidence: v.confidence,
          x: Math.max(0.01, Math.min(0.95, xNorm - wNorm / 2)),
          y: Math.max(0.01, Math.min(0.95, yNorm - hNorm / 2)),
          w: wNorm,
          h: hNorm,
          speedKmh: Math.round((isChaosMode ? 8 : 42) + this.prng.nextFloat() * 6 - 3)
        });
      });

      camerasData[camId] = {
        cameraId: camId,
        timestamp: timestamp,
        sequence: this.frameSequence,
        fps: isChaosMode ? Math.floor(15 + this.prng.nextFloat() * 4) : Math.floor(29 + this.prng.nextFloat() * 2),
        resolution: '1920x1080',
        source: 'SITS Edge Vision YOLOv8',
        provenance: 'SIMULATED',
        processingLatencyMs: isChaosMode ? Math.floor(22 + this.prng.nextFloat() * 15) : Math.floor(4 + this.prng.nextFloat() * 6),
        streamStatus: isChaosMode ? 'DEGRADED' : 'ONLINE',
        detections: detections
      };
    });

    return {
      seq: this.frameSequence,
      timestamp: timestamp,
      source: 'server',
      cameras: camerasData,
      ...Object.fromEntries(Object.entries(camerasData).map(([cid, cam]) => [cid, cam.detections]))
    };
  }

  reset() {
    this.frameSequence = 1;
    this.prng.reset();
    this.cameras.forEach(camId => {
      this.vehiclesPerCam.set(camId, this._generateInitialVehicles(camId));
    });
  }
}

export const cvEngine = new ComputerVisionEngine();
export const VisionEngine = ComputerVisionEngine;

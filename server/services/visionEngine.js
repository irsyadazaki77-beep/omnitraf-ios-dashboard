import { systemClock } from './unifiedClock.js';
import { TrafficVehicleSimulation, projectTrafficVehicle, trafficCameraConfig } from '../../shared/trafficVehicleSimulation.js';

const CAMERA_IDS = ['dashCameraCanvas', 'cctvCanvas1', 'cctvCanvas2', 'cctvCanvas3', 'cctvCanvas4'];
const TYPE_SIZE = { car: [0.105, 0.075], bus: [0.145, 0.105], truck: [0.14, 0.10], motorcycle: [0.058, 0.068], ambulance: [0.12, 0.082], person: [0.035, 0.08] };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class ComputerVisionEngine {
  constructor(options = {}) {
    this.clock = options.clock || systemClock;
    this.frameSequence = 1;
    this.latestFramePayload = null;
    this.cameras = [...CAMERA_IDS];
    const randomStream = options.randomStream || (options.randomRegistry ? options.randomRegistry.getStream('cctv') : null);
    this.vehicleSimulation = options.vehicleSimulation || new TrafficVehicleSimulation({ seed: options.seed ?? 42, randomStream });
  }

  tickSimulation(isChaosMode = false, simulationState = {}, deltaSeconds = .3) {
    const state = simulationState || {};
    this.vehicleSimulation.step({
      ...state,
      trafficModel: state.trafficModel || state,
      incidents: state.incidents || []
    }, deltaSeconds);
    if (isChaosMode) {
      for (const cameraId of this.cameras) {
        for (const vehicle of this.vehicleSimulation.getVehicles(cameraId)) {
          vehicle.speedKmh = Number((vehicle.speedKmh * .88).toFixed(2));
        }
      }
    }
  }

  generateFramePayload(isChaosMode = false, trafficModel = null, simulationState = null) {
    this.frameSequence++;
    const timestamp = this.clock.now();
    const state = simulationState || { trafficModel: trafficModel || {}, isChaosMode };
    const model = trafficModel || state.trafficModel || {};
    this.tickSimulation(isChaosMode, { ...state, trafficModel: model }, .3);
    const camerasData = {};

    for (const cameraId of this.cameras) {
      const config = trafficCameraConfig(cameraId);
      const vehicles = this.vehicleSimulation.getVehicles(cameraId);
      const corridor = config?.corridorId ? model.corridors?.find(item => item.corridorId === config.corridorId) : null;
      const speedAggregate = vehicles.length ? vehicles.reduce((sum, item) => sum + item.speedKmh, 0) / vehicles.length : 0;
      const trafficMetrics = corridor ? {
        corridorId: corridor.corridorId,
        intersectionId: corridor.intersectionId || config.nodeId,
        demandVehPerHour: corridor.demandVehPerHour,
        throughputVehPerHour: corridor.throughputVehPerHour,
        queueVehicles: corridor.queueVehicles,
        queueMeters: corridor.queueMeters,
        congestionIndex: corridor.congestionIndex,
        speedKmh: corridor.speedKmh,
        capacityVehPerHour: corridor.capacityVehPerHour,
        provenance: 'SIMULATED'
      } : {
        corridorId: null,
        scope: 'network-average',
        demandVehPerHour: model.demandVehPerHour ?? null,
        queueVehicles: model.queueVehicles ?? null,
        congestionIndex: model.congestionIndex ?? null,
        speedKmh: model.averageSpeedKmh ?? Number(speedAggregate.toFixed(1)),
        provenance: 'SIMULATED'
      };
      const node = config?.nodeId ? state.intersections?.find(item => item.id === config.nodeId) : null;
      const detections = vehicles.map(vehicle => {
        const pos = projectTrafficVehicle(vehicle, config?.scene);
        const [baseW, baseH] = TYPE_SIZE[vehicle.type] || TYPE_SIZE.car;
        const scale = clamp(pos.depth, .38, 1.25);
        const width = baseW * scale, height = baseH * scale;
        const speedKmh = Math.round(vehicle.speedKmh);
        return {
          id: vehicle.id,
          trackId: vehicle.id,
          class: vehicle.type,
          confidence: vehicle.confidence,
          x: clamp(pos.x - width / 2, .002, .998 - width),
          y: clamp(pos.y - height / 2, .002, .998 - height),
          w: width,
          h: height,
          speedKmh,
          accelerationMps2: vehicle.acceleration,
          lane: vehicle.lane,
          direction: vehicle.direction,
          progress: Number(vehicle.progress.toFixed(4)),
          movement: vehicle.movement,
          braking: vehicle.braking,
          stopped: vehicle.stopped,
          signalState: node?.state || (config?.scene === 'roundabout' ? 'yield' : 'none'),
          provenance: 'SIMULATED'
        };
      });
      const roadState = this._roadState(cameraId, state);
      camerasData[cameraId] = {
        cameraId,
        timestamp,
        sequence: this.frameSequence,
        fps: isChaosMode ? 18 : 30,
        source: 'OmniTRAF procedural traffic simulation',
        provenance: 'SIMULATED',
        processingLatencyMs: isChaosMode ? 28 : 5,
        streamStatus: isChaosMode ? 'DEGRADED' : 'ONLINE',
        scene: config?.scene,
        intersectionId: config?.nodeId || null,
        signalState: node?.state || (config?.scene === 'roundabout' ? 'yield' : 'none'),
        roadState,
        trafficMetrics,
        detections
      };
    }

    this.latestFramePayload = {
      seq: this.frameSequence,
      timestamp,
      source: 'server',
      provenance: 'SIMULATED',
      cameras: camerasData,
      ...Object.fromEntries(Object.entries(camerasData).map(([cameraId, camera]) => [cameraId, camera.detections]))
    };
    return this.latestFramePayload;
  }

  _roadState(cameraId, state) {
    const config = trafficCameraConfig(cameraId);
    const incidents = (state.incidents || []).filter(item => !['RESOLVED', 'CLOSED', 'ARCHIVED', 'CANCELLED'].includes(String(item.status || 'ACTIVE').toUpperCase()));
    const matched = incidents.filter(item => {
      const text = `${item.location || ''} ${item.title || ''} ${item.corridorId || ''} ${item.intersectionId || ''}`.toLowerCase();
      return config?.corridorId && text.includes(config.corridorId.replace('corridor-', ''));
    });
    return {
      weather: state.roadCondition === 'wet' || state.isRainMode ? 'wet-simulated' : 'dry-simulated',
      activeIncidentCount: matched.length,
      laneClosed: matched.some(item => item.laneClosed || item.laneClosure || item.closedLanes?.length),
      activeEmergencyCount: (state.activeEmergencies || []).filter(item => !['COMPLETED', 'CANCELLED'].includes(String(item.status || '').toUpperCase())).length,
      provenance: 'SIMULATED'
    };
  }

  reset() { this.frameSequence = 1; this.vehicleSimulation.reset(); this.latestFramePayload = null; }

  getSnapshot() { return { frameSequence: this.frameSequence, vehicleSimulation: this.vehicleSimulation.getSnapshot() }; }
  getLatestFramePayload() { return this.latestFramePayload ? structuredClone(this.latestFramePayload) : null; }
  restoreSnapshot(snapshot) {
    if (!snapshot || !Number.isSafeInteger(snapshot.frameSequence) || snapshot.frameSequence < 0) throw new TypeError('invalid computer vision snapshot');
    if (!snapshot.vehicleSimulation) throw new TypeError('computer vision snapshot is missing vehicle state');
    this.vehicleSimulation.restoreSnapshot(snapshot.vehicleSimulation);
    this.frameSequence = snapshot.frameSequence;
    this.latestFramePayload = null;
  }
}

export const cvEngine = new ComputerVisionEngine();
export const VisionEngine = ComputerVisionEngine;
